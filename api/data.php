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
    $formats = ['Y-m-d H:i:s.u', 'Y-m-d H:i:s'];
    foreach ($formats as $format) {
        $dt = DateTime::createFromFormat($format, $lastUpdateParam);
        if ($dt instanceof DateTime) {
            $lastUpdateTime = $dt->format('Y-m-d H:i:s.u');
            break;
        }
    }
}

$isIncremental = !empty($lastUpdateTime);
session_write_close(); // Unblock session

function buildStateSnapshot(PDO $pdo, int $current_user_id): array {
    $snapshotStmt = $pdo->prepare('
        SELECT
            (SELECT MAX(updated_at) FROM users) as users_updated_at,
            (SELECT MAX(updated_at) FROM relationships) as rels_updated_at,
            (SELECT MAX(updated_at) FROM requests WHERE to_id = ? AND status = "PENDING") as req_updated_at,
            (SELECT COUNT(*) FROM requests WHERE to_id = ? AND status = "PENDING") as req_count
    ');
    $snapshotStmt->execute([$current_user_id, $current_user_id]);
    $row = $snapshotStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    $reqState = [
        'req_updated_at' => $row['req_updated_at'] ?? null,
        'req_count' => $row['req_count'] ?? 0
    ];

    $etagParts = [
        $row['users_updated_at'] ?: '0',
        $row['rels_updated_at'] ?: '0',
        $reqState['req_updated_at'] ?? '0',
        $reqState['req_count'] ?? 0,
        $current_user_id
    ];

    return [
        'users_updated_at' => $row['users_updated_at'] ?? null,
        'rels_updated_at'  => $row['rels_updated_at'] ?? null,
        'req_state'     => $reqState,
        'etag'          => md5(implode('|', $etagParts)),
    ];
}

try {
    $waitForChange = isset($_GET['wait']) && $_GET['wait'] === 'true';
    $clientEtag = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH'], '"') : null;

    $stateSnapshot = buildStateSnapshot($pdo, (int)$current_user_id);
    $etag = $stateSnapshot['etag'];

    if ($waitForChange && $clientEtag) {
        $timeoutSeconds = 20;
        $start = microtime(true);
        $attempt = 0;

        while ($etag === $clientEtag && (microtime(true) - $start) < $timeoutSeconds) {
            $attempt++;
            if ($attempt <= 5) {
                usleep(500000);
            } else {
                usleep(1000000);
            }
            $stateSnapshot = buildStateSnapshot($pdo, (int)$current_user_id);
            $etag = $stateSnapshot['etag'];
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

    $relUpdate = $stateSnapshot['rels_updated_at'] ?? '0000-00-00 00:00:00.000000';
    $userUpdate = $stateSnapshot['users_updated_at'] ?? '0000-00-00 00:00:00.000000';
    $clientNextCursor = max($relUpdate, $userUpdate);

    // 1. Get nodes (incremental if last_update provided)
    if ($isIncremental) {
        // Fix: Subtract 2 seconds from the timestamp to catch overlapping transactions (Race Condition Fix)
        // Note: ensure your DB supports DATE_SUB, or calculate in PHP. 
        // Calculating in PHP is safer for database portability.
        $bufferedTime = date('Y-m-d H:i:s.u', strtotime($lastUpdateTime) - 2); 
        $stmt = $pdo->prepare('SELECT id, username, real_name, avatar, signature FROM users WHERE updated_at > ?');
        $stmt->execute([$bufferedTime]);
        $nodes = $stmt->fetchAll();
    } else {
        $nodes = $pdo->query('SELECT id, username, real_name, avatar, signature FROM users')->fetchAll();
    }

    // 2. Get relationships (incremental if last_update provided)
    if ($isIncremental) {
        $bufferedTime = date('Y-m-d H:i:s.u', strtotime($lastUpdateTime) - 2);
        $stmt = $pdo->prepare('SELECT from_id, to_id, type, last_msg_id, deleted_at FROM relationships WHERE updated_at > ?');
        $stmt->execute([$bufferedTime]);
        $edges = $stmt->fetchAll();
    } else {
        $edges = $pdo->query('SELECT from_id, to_id, type, last_msg_id, deleted_at FROM relationships WHERE deleted_at IS NULL')->fetchAll();
    }

    // 3. Get pending requests
    $stmt = $pdo->prepare('
        SELECT r.id, r.from_id, r.type, u.username
        FROM requests r
        JOIN users u ON r.from_id = u.id
        WHERE r.to_id = ? AND r.status = "PENDING"
        ORDER BY r.updated_at DESC
    ');
    $stmt->execute([$current_user_id]);
    $requests = $stmt->fetchAll();

    // 4. Format data for frontend
    $formattedNodes = array_map(function($u) {
        $uid = (int)$u['id'];
        return [
            'id' => $uid,
            'name' => $u['real_name'], // Primary display name
            'username' => $u['username'], // Unique handle
            'avatar' => "assets/" . $u['avatar'],
            'signature' => $u['signature'] ?? 'No gossip yet.',
            'val' => 1,
            'last_msg_id' => 0
        ];
    }, $nodes);

    $formattedEdges = array_map(function($e) {
        return [
            'source' => (int)$e['from_id'],
            'target' => (int)$e['to_id'],
            'type'   => $e['type'],
            'last_msg_id' => isset($e['last_msg_id']) ? (int)$e['last_msg_id'] : 0,
            'deleted'=> isset($e['deleted_at']) ? $e['deleted_at'] !== null : false
        ];
    }, $edges);

    echo json_encode([
        'nodes' => $formattedNodes,
        'links' => $formattedEdges,
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
