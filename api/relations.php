<?php
// gspc2/api/relations.php
require_once '../config/db.php';
require_once '../config/auth.php';
require_once '../config/csrf.php';

header('Content-Type: application/json');

require_login();

// Optimization: Close session to prevent blocking other requests
// We only need read access to session_id, which we already have.
// Note: csrf check might need session? checkCsrf() reads session.
// So we should do checkCsrf() before closing session.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    checkCsrf();
}
$user_id = $_SESSION["user_id"];
session_write_close(); // Release session lock

$action = $_POST["action"] ?? "";

try {
    // 发起请求
    if ($action === "request") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $type = $_POST["type"] ?? "";
        
        // Use constants for validation
        if ($to_id && in_array($type, RELATION_TYPES) && $to_id !== $user_id) {
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
                updateSystemState($pdo);
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Request pending']);
            }
        } else {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid parameters']);
        }
    }
    // Update relationship type (Now creates a request)
    elseif ($action === "update") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $type = $_POST["type"] ?? "";

        if ($to_id && in_array($type, RELATION_TYPES) && $to_id !== $user_id) {
            // Check existence
            $checkRel = $pdo->prepare("SELECT id FROM relationships WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)");
            $checkRel->execute([$user_id, $to_id, $to_id, $user_id]);

            if ($checkRel->fetch()) {
                // Check if a pending request already exists to avoid spam
                $checkReq = $pdo->prepare("SELECT id FROM requests WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) AND status='PENDING'");
                $checkReq->execute([$user_id, $to_id, $to_id, $user_id]);

                if (!$checkReq->fetch()) {
                    $stmt = $pdo->prepare('INSERT INTO requests (from_id, to_id, type) VALUES (?, ?, ?)');
                    $stmt->execute([$user_id, $to_id, $type]);
                    updateSystemState($pdo);
                    echo json_encode(['success' => true, 'message' => 'Update request sent']);
                } else {
                    echo json_encode(['success' => false, 'error' => 'Request pending']);
                }
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Relationship not found']);
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
            $pdo->beginTransaction();

            // 1. 更新请求状态
            $upd = $pdo->prepare('UPDATE requests SET status = "ACCEPTED" WHERE id=?');
            $upd->execute([$req_id]);

            // 2. Check if relationship exists (for update or new)
            $checkRel = $pdo->prepare("SELECT id FROM relationships WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)");
            $checkRel->execute([$request['from_id'], $request['to_id'], $request['to_id'], $request['from_id']]);
            $existingRel = $checkRel->fetch();

            try {
                if ($existingRel) {
                    // Update existing relationship
                    $updateRel = $pdo->prepare("UPDATE relationships SET type = ? WHERE id = ?");
                    $updateRel->execute([$request['type'], $existingRel['id']]);
                } else {
                    // Create new relationship
                    $ins = $pdo->prepare('INSERT INTO relationships (from_id, to_id, type) VALUES (?,?,?)');
                    $ins->execute([$request['from_id'], $request['to_id'], $request['type']]);
                }
                updateSystemState($pdo);
                $pdo->commit();
                echo json_encode(['success' => true]);
            } catch (PDOException $e) {
                $pdo->rollBack();
                // Check for duplicate entry error (Race condition caught by DB)
                if ($e->getCode() == 23000) {
                     echo json_encode(['success' => false, 'error' => 'Relationship already exists (Race Condition Detected)']);
                } else {
                    throw $e;
                }
            }
        } else {
            echo json_encode(['success' => false, 'message' => 'Request not found']);
        }
    }
    // 拒绝请求
    elseif ($action === "reject_request") {
        $req_id = (int)($_POST["request_id"] ?? 0);
        $stmt = $pdo->prepare('UPDATE requests SET status = "REJECTED" WHERE id=? AND to_id=?');
        $stmt->execute([$req_id, $user_id]);
        updateSystemState($pdo);
        echo json_encode(['success' => true]);
    }
    // 删除关系
    elseif ($action === "remove") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        if ($to_id) {
            $sql = 'DELETE FROM relationships WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)';
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$user_id, $to_id, $to_id, $user_id]);
            updateSystemState($pdo);
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