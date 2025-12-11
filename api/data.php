<?php
// api/data.php
require_once '../config/db.php';

header('Content-Type: application/json');

if (!isset($_SESSION["user_id"])) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

$current_user_id = $_SESSION["user_id"];
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

    // 1. Get all nodes
    $nodes = $pdo->query('SELECT id, username, real_name, avatar, signature FROM users')->fetchAll();

    // 2. Get all relationships
    $edges = $pdo->query('SELECT from_id, to_id, type FROM relationships')->fetchAll();

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

    // 4. Get last message ID for each conversation involving the current user
    $msgStmt = $pdo->prepare('
        SELECT
            CASE
                WHEN from_id = ? THEN to_id
                ELSE from_id
            END as other_id,
            MAX(id) as last_msg_id
        FROM messages
        WHERE from_id = ? OR to_id = ?
        GROUP BY other_id
    ');
    $msgStmt->execute([$current_user_id, $current_user_id, $current_user_id]);
    $lastMessages = $msgStmt->fetchAll(PDO::FETCH_KEY_PAIR); // [other_id => last_msg_id]

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
        'requests' => $requests,
        'current_user_id' => (int)$current_user_id
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
