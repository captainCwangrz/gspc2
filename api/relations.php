<?php
// gspc2/api/relations.php
require_once '../config/db.php'; // 修正引用路径
require_once '../config/csrf.php';

header('Content-Type: application/json');

if(!isset($_SESSION["user_id"])) {
    http_response_code(401);
    exit(json_encode(['error' => 'Unauthorized']));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    checkCsrf();
}

$user_id = $_SESSION["user_id"];
$action = $_POST["action"] ?? "";

try {
    // 发起请求
    if ($action === "request") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $type = $_POST["type"] ?? "";
        
        // 简单校验 type 合法性
        $valid_types = ['DATING', 'BEST_FRIEND', 'BROTHER', 'SISTER', 'BEEFING', 'CRUSH'];
        
        if ($to_id && in_array($type, $valid_types) && $to_id !== $user_id) {
            // 1. 检查是否已有关系 (双向)
            $checkRel = $pdo->prepare("SELECT id FROM relationships WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)");
            $checkRel->execute([$user_id, $to_id, $to_id, $user_id]);
            if ($checkRel->fetch()) {
                echo json_encode(['success' => false, 'error' => 'Relationship already exists']);
                exit;
            }

            // 2. 检查是否已有 Pending 请求 (双向 - 避免重复或交叉请求)
            $checkReq = $pdo->prepare("SELECT id FROM requests WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) AND status='PENDING'");
            $checkReq->execute([$user_id, $to_id, $to_id, $user_id]);

            if(!$checkReq->fetch()) {
                $stmt = $pdo->prepare('INSERT INTO requests (from_id, to_id, type) VALUES (?, ?, ?)');
                $stmt->execute([$user_id, $to_id, $type]);
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Request pending']);
            }
        } else {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid parameters']);
        }
    }
    // 接受请求
    elseif ($action === "accept_request") {
        $req_id = (int)($_POST["request_id"] ?? 0);
        
        // 验证该请求是否是发给当前用户的
        $stmt = $pdo->prepare('SELECT * FROM requests WHERE id=? AND to_id=? AND status="PENDING"');
        $stmt->execute([$req_id, $user_id]);
        $request = $stmt->fetch();

        if ($request) {
            // Double check: ensure no relationship exists
            $checkRel = $pdo->prepare("SELECT id FROM relationships WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)");
            $checkRel->execute([$request['from_id'], $request['to_id'], $request['to_id'], $request['from_id']]);

            if ($checkRel->fetch()) {
                // Relationship already exists, void this request
                $pdo->prepare('UPDATE requests SET status = "REJECTED" WHERE id=?')->execute([$req_id]);
                echo json_encode(['success' => false, 'error' => 'Relationship already exists']);
                exit;
            }

            $pdo->beginTransaction();
            // 1. 更新请求状态
            $upd = $pdo->prepare('UPDATE requests SET status = "ACCEPTED" WHERE id=?');
            $upd->execute([$req_id]);
            
            // 2. 建立双向关系
            $ins = $pdo->prepare('INSERT INTO relationships (from_id, to_id, type) VALUES (?,?,?)');
            $ins->execute([$request['from_id'], $request['to_id'], $request['type']]);
            
            $pdo->commit();
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Request not found']);
        }
    }
    // 拒绝请求
    elseif ($action === "reject_request") {
        $req_id = (int)($_POST["request_id"] ?? 0);
        $stmt = $pdo->prepare('UPDATE requests SET status = "REJECTED" WHERE id=? AND to_id=?');
        $stmt->execute([$req_id, $user_id]);
        echo json_encode(['success' => true]);
    }
    // 删除关系
    elseif ($action === "remove") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        if ($to_id) {
            $sql = 'DELETE FROM relationships WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)';
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$user_id, $to_id, $to_id, $user_id]);
            echo json_encode(['success' => true]);
        }
    }
    else {
        echo json_encode(['success' => false, 'message' => 'Unknown action']);
    }
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>