<?php
// api/data.php
require_once '../config/db.php';
require_once '../config/auth.php';

header('Content-Type: application/json');

require_login();

$current_user_id = $_SESSION["user_id"];
$lastUpdateParam = $_GET['last_update'] ?? null;
$lastUpdateTime = null;

if ($lastUpdateParam) {
    $parsedTime = strtotime($lastUpdateParam);
    if ($parsedTime !== false) {
        $lastUpdateTime = date('Y-m-d H:i:s', $parsedTime);
    }
}

$isIncremental = !empty($lastUpdateTime);
session_write_close(); // Unblock session

function buildStateSnapshot(PDO $pdo, int $current_user_id): array {
    $stmt = $pdo->query("SELECT last_update FROM system_state WHERE id = 1");
    $graphState = $stmt->fetchColumn();

    $relStmt = $pdo->prepare('SELECT MAX(updated_at) FROM relationships WHERE from_id = ? OR to_id = ?');
    $relStmt->execute([$current_user_id, $current_user_id]);
    $relUpdatedAt = $relStmt->fetchColumn();

    $reqStmt = $pdo->prepare('
        SELECT MAX(id) as max_req_id, COUNT(*) as req_count
        FROM requests
        WHERE to_id = ? AND status = "PENDING"
    ');
    $reqStmt->execute([$current_user_id]);
    $reqState = $reqStmt->fetch(PDO::FETCH_ASSOC);

    $etagParts = [
        $graphState,
        $relUpdatedAt ?: '0',
        $reqState['max_req_id'],
        $reqState['req_count'],
        $current_user_id
    ];

    return [
        'graph_state'   => $graphState,
        'rel_updated_at'=> $relUpdatedAt,
        'req_state'     => $reqState,
        'etag'          => md5(implode('|', $etagParts)),
    ];
}

try {
    $waitForChange = isset($_GET['wait']) && $_GET['wait'] === 'true';
    $clientEtag = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH'], '"') : null;

    $stateSnapshot = buildStateSnapshot($pdo, (int)$current_user_id);
    $etag = $stateSnapshot['etag'];
    $graphState = $stateSnapshot['graph_state'];

    if ($waitForChange && $clientEtag) {
        $timeoutSeconds = 20;
        $start = microtime(true);

        while ($etag === $clientEtag && (microtime(true) - $start) < $timeoutSeconds) {
            usleep(500000); // 0.5s
            $stateSnapshot = buildStateSnapshot($pdo, (int)$current_user_id);
            $etag = $stateSnapshot['etag'];
            $graphState = $stateSnapshot['graph_state'];
        }

        if ($etag === $clientEtag) {
            header('ETag: "' . $etag . '"');
            header('Cache-Control: no-cache, must-revalidate');
            header('X-Long-Poll-Timeout: 1');
            http_response_code(304);
            exit;
        }
    }

    header('ETag: "' . $etag . '"');
    header('Cache-Control: no-cache, must-revalidate'); // Force browser to check ETag

    if ($clientEtag && $clientEtag === $etag) {
        http_response_code(304);
        exit;
    }

    // --- Full Data Fetch (Only if Changed) ---

    $relUpdate = $stateSnapshot['rel_updated_at'] ?? '0000-00-00 00:00:00';
    $clientNextCursor = ($relUpdate > $graphState) ? $relUpdate : $graphState;

    // 1. Get nodes (incremental if last_update provided)
    if ($isIncremental) {
        $stmt = $pdo->prepare('SELECT id, username, real_name, avatar, signature FROM users WHERE updated_at > ?');
        $stmt->execute([$lastUpdateTime]);
        $nodes = $stmt->fetchAll();
    } else {
        $nodes = $pdo->query('SELECT id, username, real_name, avatar, signature FROM users')->fetchAll();
    }

    // 2. Get relationships (incremental if last_update provided)
    if ($isIncremental) {
        $stmt = $pdo->prepare('SELECT from_id, to_id, type, last_msg_id FROM relationships WHERE updated_at > ?');
        $stmt->execute([$lastUpdateTime]);
        $edges = $stmt->fetchAll();
    } else {
        $edges = $pdo->query('SELECT from_id, to_id, type, last_msg_id FROM relationships')->fetchAll();
    }

    // 3. Get pending requests
    $stmt = $pdo->prepare('
        SELECT r.id, r.from_id, r.type, u.username
        FROM requests r
        JOIN users u ON r.from_id = u.id
        WHERE r.to_id = ? AND r.status = "PENDING"
        ORDER BY r.id DESC
    ');
    $stmt->execute([$current_user_id]);
    $requests = $stmt->fetchAll();

    // 4. Build last message map using denormalized relationship metadata for notification sync
    $lastMessages = [];
    foreach ($edges as $edge) {
        $fromId = (int)$edge['from_id'];
        $toId = (int)$edge['to_id'];
        $lastId = isset($edge['last_msg_id']) ? (int)$edge['last_msg_id'] : 0;

        if ($fromId === (int)$current_user_id) {
            $key = (string)$toId;
            $lastMessages[$key] = max($lastMessages[$key] ?? 0, $lastId);
        } elseif ($toId === (int)$current_user_id) {
            $key = (string)$fromId;
            $lastMessages[$key] = max($lastMessages[$key] ?? 0, $lastId);
        }
    }

    // 5. Format data for frontend
    $formattedNodes = array_map(function($u) use ($lastMessages) {
        $uid = (int)$u['id'];
        return [
            'id' => $uid,
            'name' => $u['real_name'], // Primary display name
            'username' => $u['username'], // Unique handle
            'avatar' => "assets/" . $u['avatar'],
            'signature' => $u['signature'] ?? 'No gossip yet.',
            'val' => 1,
            'last_msg_id' => isset($lastMessages[$uid]) ? (int)$lastMessages[$uid] : 0
        ];
    }, $nodes);

    $formattedEdges = array_map(function($e) {
        return [
            'source' => (int)$e['from_id'],
            'target' => (int)$e['to_id'],
            'type'   => $e['type']
        ];
    }, $edges);

    echo json_encode([
        'nodes' => $formattedNodes,
        'links' => $formattedEdges,
        'last_messages' => $lastMessages,
        'requests' => $requests,
        'current_user_id' => (int)$current_user_id,
        'last_update' => $clientNextCursor,
        'incremental' => $isIncremental
    ]);

} catch (PDOException $e) {
    error_log('Data endpoint PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Internal Server Error']);
} catch (Exception $e) {
    error_log('Data endpoint error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Internal Server Error']);
}
