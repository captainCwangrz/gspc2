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

function respond(bool $success, array $payload = [], int $statusCode = 200): void {
    if ($statusCode !== 200) {
        http_response_code($statusCode);
    }

    echo json_encode(array_merge(['success' => $success], $payload));
}

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

function userExists(int $userId, PDO $pdo): bool {
    $stmt = $pdo->prepare('SELECT 1 FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    return (bool) $stmt->fetchColumn();
}

function getPairActiveRels(int $a, int $b, PDO $pdo): array {
    if ($a === $b) return [];
    $sql = 'SELECT id, from_id, to_id, type FROM relationships WHERE deleted_at IS NULL AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$a, $b, $b, $a]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

try {
    // 发起请求
    if ($action === "request") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $type = $_POST["type"] ?? "";

        if (!$to_id || $to_id === $user_id || !in_array($type, RELATION_TYPES, true)) {
            respond(false, ['error' => 'Invalid parameters'], 400);
            exit;
        }

        if (!userExists($to_id, $pdo)) {
            respond(false, ['error' => 'Target user not found'], 404);
            exit;
        }

        $pairRels = getPairActiveRels($user_id, $to_id, $pdo);
        $hasUndirected = array_reduce($pairRels, fn($carry, $rel) => $carry || !isDirectedType($rel['type']), false);
        $hasOutgoingSameType = array_reduce($pairRels, function($carry, $rel) use ($user_id, $type) {
            return $carry || ($rel['from_id'] == $user_id && $rel['type'] === $type);
        }, false);

        if ($hasOutgoingSameType || (!isDirectedType($type) && $hasUndirected)) {
            respond(false, ['error' => 'Relationship already exists'], 400);
            exit;
        }

        $checkReq = $pdo->prepare('SELECT id FROM requests WHERE from_id = ? AND to_id = ? AND status = "PENDING"');
        $checkReq->execute([$user_id, $to_id]);

        if($checkReq->fetch()) {
            respond(false, ['error' => 'Request pending'], 400);
            exit;
        }

        $stmt = $pdo->prepare('INSERT INTO requests (from_id, to_id, type) VALUES (?, ?, ?)');
        $stmt->execute([$user_id, $to_id, $type]);
        respond(true, ['message' => 'Request sent']);
    }
    // Update relationship type (Now creates a request)
    elseif ($action === "update") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $type = $_POST["type"] ?? "";

        if (!$to_id || $to_id === $user_id || !in_array($type, RELATION_TYPES, true)) {
            respond(false, ['error' => 'Invalid parameters'], 400);
            exit;
        }

        if (!userExists($to_id, $pdo)) {
            respond(false, ['error' => 'Target user not found'], 404);
            exit;
        }

        $pairRels = getPairActiveRels($user_id, $to_id, $pdo);
        if (empty($pairRels)) {
            respond(false, ['error' => 'No active relationship to update'], 404);
            exit;
        }

        $hasOutgoingCrush = false;
        $hasUndirected = false;
        foreach ($pairRels as $rel) {
            if ($rel['type'] === 'CRUSH' && (int)$rel['from_id'] === $user_id) {
                $hasOutgoingCrush = true;
            }
            if (!isDirectedType($rel['type'])) {
                $hasUndirected = true;
            }
        }

        $canUpdate = false;
        if ($type === 'CRUSH' && ($hasOutgoingCrush || $hasUndirected)) {
            $canUpdate = true;
        }
        if (!isDirectedType($type) && ($hasUndirected || $hasOutgoingCrush)) {
            $canUpdate = true;
        }

        if (!$canUpdate) {
            respond(false, ['error' => 'No active relationship to update'], 404);
            exit;
        }

        $checkReq = $pdo->prepare('SELECT id FROM requests WHERE from_id = ? AND to_id = ? AND status = "PENDING"');
        $checkReq->execute([$user_id, $to_id]);
        if ($checkReq->fetch()) {
            respond(false, ['error' => 'Request pending'], 400);
            exit;
        }

        $stmt = $pdo->prepare('INSERT INTO requests (from_id, to_id, type) VALUES (?, ?, ?)');
        $stmt->execute([$user_id, $to_id, $type]);
        respond(true, ['message' => 'Update request sent']);
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

            try {
                // Lock related relationships for this pair
                $lockStmt = $pdo->prepare('SELECT id FROM relationships WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) FOR UPDATE');
                $lockStmt->execute([(int)$request['from_id'], (int)$request['to_id'], (int)$request['to_id'], (int)$request['from_id']]);

                $upd = $pdo->prepare('UPDATE requests SET status = "ACCEPTED" WHERE id=?');
                $upd->execute([$req_id]);

                if ($request['type'] === 'CRUSH') {
                    // Remove undirected canonical
                    $canonFrom = min((int)$request['from_id'], (int)$request['to_id']);
                    $canonTo = max((int)$request['from_id'], (int)$request['to_id']);
                    $softDeleteUndirected = $pdo->prepare('UPDATE relationships SET deleted_at = NOW(6) WHERE deleted_at IS NULL AND type != "CRUSH" AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))');
                    $softDeleteUndirected->execute([$canonFrom, $canonTo, $canonTo, $canonFrom]);

                    $insertCrush = $pdo->prepare('INSERT INTO relationships (from_id, to_id, type, deleted_at) VALUES (?, ?, "CRUSH", NULL) ON DUPLICATE KEY UPDATE type="CRUSH", deleted_at=NULL, updated_at=NOW(6)');
                    $insertCrush->execute([(int)$request['from_id'], (int)$request['to_id']]);
                } else {
                    // Remove crush edges
                    $softDeleteCrush = $pdo->prepare('UPDATE relationships SET deleted_at = NOW(6) WHERE deleted_at IS NULL AND type = "CRUSH" AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))');
                    $softDeleteCrush->execute([(int)$request['from_id'], (int)$request['to_id'], (int)$request['to_id'], (int)$request['from_id']]);

                    [$normFrom, $normTo] = normalizeFromTo($request['type'], (int)$request['from_id'], (int)$request['to_id']);
                    $insertUndirected = $pdo->prepare('INSERT INTO relationships (from_id, to_id, type, deleted_at) VALUES (?, ?, ?, NULL) ON DUPLICATE KEY UPDATE type=VALUES(type), deleted_at=NULL, updated_at=NOW(6)');
                    $insertUndirected->execute([$normFrom, $normTo, $request['type']]);
                }

                $pdo->commit();
                respond(true, ['message' => 'Request accepted']);
            } catch (PDOException $e) {
                $pdo->rollBack();
                if ($e->getCode() == 23000) {
                    respond(false, ['error' => 'Relationship already exists (Race Condition Detected)'], 400);
                } else {
                    throw $e;
                }
            }
        } else {
            respond(false, ['error' => 'Request not found'], 404);
        }
    }
    // 拒绝请求
    elseif ($action === "reject_request") {
        $req_id = (int)($_POST["request_id"] ?? 0);
        $stmt = $pdo->prepare('UPDATE requests SET status = "REJECTED" WHERE id=? AND to_id=?');
        $stmt->execute([$req_id, $user_id]);
        respond(true, ['message' => 'Request rejected']);
    }
    // 删除关系
    elseif ($action === "remove") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        if (!$to_id || $to_id === $user_id) {
            respond(false, ['error' => 'Invalid parameters'], 400);
            exit;
        }

        if (!userExists($to_id, $pdo)) {
            respond(false, ['error' => 'Target user not found'], 404);
            exit;
        }

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

        if (empty($idsToDelete)) {
            respond(false, ['error' => 'No removable relationship found'], 404);
            exit;
        }

        $placeholders = implode(',', array_fill(0, count($idsToDelete), '?'));
        $del = $pdo->prepare("UPDATE relationships SET deleted_at = NOW(6), updated_at = NOW(6) WHERE id IN ($placeholders)");
        $del->execute($idsToDelete);

        respond(true, ['message' => 'Relationship removed']);
    }
    else {
        respond(false, ['error' => 'Unknown action'], 400);
    }
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('Relations endpoint PDO error: ' . $e->getMessage());
    respond(false, ['error' => 'Internal Server Error'], 500);
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('Relations endpoint error: ' . $e->getMessage());
    respond(false, ['error' => 'Internal Server Error'], 500);
}
?>