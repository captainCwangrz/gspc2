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

try {
    // --- ETag / Caching Logic ---

    // Efficiently query state hash using system_state
    $stmt = $pdo->query("SELECT last_update FROM system_state WHERE id = 1");
    $graphState = $stmt->fetchColumn();

    // Personal state (requests & messages)
    // We include last_msg_id and MAX(timestamp) in hash to ensure we catch all updates
    $msgStmt = $pdo->prepare('
        SELECT CONCAT(MAX(id), "-", MAX(timestamp)) as msg_hash FROM messages
        WHERE from_id = ? OR to_id = ?
    ');
    $msgStmt->execute([$current_user_id, $current_user_id]);
    $msgHash = $msgStmt->fetchColumn();

    $reqStmt = $pdo->prepare('
        SELECT MAX(id) as max_req_id, COUNT(*) as req_count
        FROM requests
        WHERE to_id = ? AND status = "PENDING"
    ');
    $reqStmt->execute([$current_user_id]);
    $reqState = $reqStmt->fetch(PDO::FETCH_ASSOC);

    $etagParts = [
        $graphState,
        $msgHash,
        $reqState['max_req_id'],
        $reqState['req_count'],
        $current_user_id
    ];

    $etag = md5(implode('|', $etagParts));

    header('ETag: "' . $etag . '"');
    header('Cache-Control: no-cache, must-revalidate'); // Force browser to check ETag

    if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH'], '"') === $etag) {
        http_response_code(304);
        exit;
    }

    // --- Full Data Fetch (Only if Changed) ---

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
        'last_update' => $graphState,
        'incremental' => $isIncremental
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
