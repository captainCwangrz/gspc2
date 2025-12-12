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

function isDirectedType(string $type): bool {
    return in_array($type, DIRECTED_RELATION_TYPES, true);
}

function normalizeFromTo(string $type, int $from, int $to): array {
    if (isDirectedType($type)) {
        return [$from, $to];
    }

    return [$from < $to ? $from : $to, $from < $to ? $to : $from];
}

function buildRelWhere(string $type, int $fromId, int $toId): array {
    if (isDirectedType($type)) {
        return ['from_id=? AND to_id=?', [$fromId, $toId]];
    }

    return ['((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))', [$fromId, $toId, $toId, $fromId]];
}

try {
    // 发起请求
    if ($action === "request") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $type = $_POST["type"] ?? "";

        // Use constants for validation
        if ($to_id && in_array($type, RELATION_TYPES) && $to_id !== $user_id) {
            [$relWhere, $relParams] = buildRelWhere($type, $user_id, $to_id);

            // 1. 检查是否已有关系
            $checkRel = $pdo->prepare("SELECT id FROM relationships WHERE deleted_at IS NULL AND $relWhere");
            $checkRel->execute($relParams);
            if ($checkRel->fetch()) {
                echo json_encode(['success' => false, 'error' => 'Relationship already exists']);
                exit;
            }

            // 2. 检查是否已有 Pending 请求
            $checkReq = $pdo->prepare("SELECT id FROM requests WHERE $relWhere AND status='PENDING'");
            $checkReq->execute($relParams);

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
    // Update relationship type (Now creates a request)
    elseif ($action === "update") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $type = $_POST["type"] ?? "";

        if ($to_id && in_array($type, RELATION_TYPES) && $to_id !== $user_id) {
            [$relWhere, $relParams] = buildRelWhere($type, $user_id, $to_id);

            // Check existence
            $checkRel = $pdo->prepare("SELECT id FROM relationships WHERE deleted_at IS NULL AND $relWhere");
            $checkRel->execute($relParams);

            if ($checkRel->fetch()) {
                // Check if a pending request already exists to avoid spam
                $checkReq = $pdo->prepare("SELECT id FROM requests WHERE $relWhere AND status='PENDING'");
                $checkReq->execute($relParams);

                if (!$checkReq->fetch()) {
                    $stmt = $pdo->prepare('INSERT INTO requests (from_id, to_id, type) VALUES (?, ?, ?)');
                    $stmt->execute([$user_id, $to_id, $type]);
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
            [$normFrom, $normTo] = normalizeFromTo($request['type'], (int)$request['from_id'], (int)$request['to_id']);
            [$relWhere, $relParams] = buildRelWhere($request['type'], $normFrom, $normTo);
            $checkRel = $pdo->prepare("SELECT id, from_id, to_id, deleted_at FROM relationships WHERE $relWhere LIMIT 1");
            $checkRel->execute($relParams);
            $existingRel = $checkRel->fetch();

            try {
                if ($existingRel) {
                    // Update existing relationship
                    $updateRel = $pdo->prepare("UPDATE relationships SET from_id = ?, to_id = ?, type = ?, deleted_at = NULL WHERE id = ?");
                    $updateRel->execute([$normFrom, $normTo, $request['type'], $existingRel['id']]);
                } else {
                    // Create new relationship
                    $ins = $pdo->prepare('INSERT INTO relationships (from_id, to_id, type) VALUES (?,?,?)');
                    $ins->execute([$normFrom, $normTo, $request['type']]);
                }
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
        echo json_encode(['success' => true]);
    }
    // 删除关系
    elseif ($action === "remove") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        if ($to_id) {
            $fetch = $pdo->prepare('SELECT id, type, from_id, to_id FROM relationships WHERE deleted_at IS NULL AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))');
            $fetch->execute([$user_id, $to_id, $to_id, $user_id]);
            $rows = $fetch->fetchAll(PDO::FETCH_ASSOC);

            $idsToDelete = [];
            foreach ($rows as $row) {
                if (isDirectedType($row['type'])) {
                    if ((int)$row['from_id'] === $user_id && (int)$row['to_id'] === $to_id) {
                        $idsToDelete[] = (int)$row['id'];
                    }
                } else {
                    $idsToDelete[] = (int)$row['id'];
                }
            }

            if (!empty($idsToDelete)) {
                $placeholders = implode(',', array_fill(0, count($idsToDelete), '?'));
                $del = $pdo->prepare("UPDATE relationships SET deleted_at = NOW(6) WHERE id IN ($placeholders)");
                $del->execute($idsToDelete);
            }
            echo json_encode(['success' => true]);
        }
    }
    else {
        echo json_encode(['success' => false, 'message' => 'Unknown action']);
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('Relations endpoint PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Internal Server Error']);
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('Relations endpoint error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Internal Server Error']);
}
?>