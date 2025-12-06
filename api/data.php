<?php
// api/data.php
require_once '../config/db.php';

header('Content-Type: application/json');

if (!isset($_SESSION["user_id"])) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

try {
    $current_user_id = $_SESSION["user_id"];

    // 1. Get all nodes
    $nodes = $pdo->query('SELECT id, username, avatar, signature, x_pos, y_pos FROM users')->fetchAll();

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
    // This allows the frontend to determine if there are new messages
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
            'name' => $u['username'],
            'avatar' => "assets/" . $u['avatar'],
            'signature' => $u['signature'] ?? 'No gossip yet.',
            'x' => (float)$u['x_pos'],
            'y' => (float)$u['y_pos'],
            'z' => 0,
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
