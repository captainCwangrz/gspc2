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
    // 1. 获取所有节点
    $nodes = $pdo->query('SELECT id, username, avatar, signature, x_pos, y_pos FROM users')->fetchAll();

    // 2. 获取所有关系边
    $edges = $pdo->query('SELECT from_id, to_id, type FROM relationships')->fetchAll();

    // 3. 获取待处理请求 (仅针对当前用户)
    $stmt = $pdo->prepare('
        SELECT r.id, r.from_id, r.type, u.username 
        FROM requests r
        JOIN users u ON r.from_id = u.id
        WHERE r.to_id = ? AND r.status = "PENDING"
        ORDER BY r.id DESC
    ');
    $stmt->execute([$_SESSION["user_id"]]);
    $requests = $stmt->fetchAll();

    // 4. 格式化数据以适应前端
    $formattedNodes = array_map(function($u) {
        return [
            'id' => (int)$u['id'],
            'name' => $u['username'],
            'avatar' => "assets/" . $u['avatar'],
            'signature' => $u['signature'] ?? 'No gossip yet.',
            'x' => (float)$u['x_pos'], // 保持位置持久化
            'y' => (float)$u['y_pos'],
            'z' => 0, // 2D平面分布在3D空间
            'val' => 1
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
        'current_user_id' => (int)$_SESSION["user_id"]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}