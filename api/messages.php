<?php
// gspc2/api/messages.php
require_once '../config/db.php';
require_once '../config/auth.php';
require_once '../config/csrf.php';
require_once '../config/helpers.php';

header('Content-Type: application/json');

require_login();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    checkCsrf();
}

$user_id = $_SESSION["user_id"];
session_write_close(); // Unblock session

$action = $_POST["action"] ?? $_GET["action"] ?? "";

function getActiveRelationships(int $fromId, int $toId, PDO $pdo): array {
    if ($fromId === $toId) return [];
    $sql = 'SELECT id, from_id, to_id, type FROM relationships WHERE deleted_at IS NULL AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$fromId, $toId, $toId, $fromId]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function userExists(int $userId, PDO $pdo): bool {
    $stmt = $pdo->prepare('SELECT 1 FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    return (bool) $stmt->fetchColumn();
}

try {
    // Send Message
    if ($action === "send") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $message = trim($_POST["message"] ?? "");

        if (!$to_id || !userExists($to_id, $pdo)) {
            http_response_code(404);
            echo json_encode(['error' => 'Target user not found']);
            exit;
        }

        if ($message === "") {
            http_response_code(400);
            echo json_encode(['error' => 'Message cannot be empty']);
            exit;
        }

        $messageLength = function_exists('mb_strlen') ? mb_strlen($message, 'UTF-8') : strlen($message);
        if ($messageLength > 1000) {
            http_response_code(400);
            echo json_encode(['error' => 'Message too long']);
            exit;
        }

        // Strict check: Must have active relationship to send
        $activeRelationships = getActiveRelationships($user_id, $to_id, $pdo);
        if (empty($activeRelationships)) {
            http_response_code(403);
            echo json_encode(['error' => 'Relationship required to send messages']);
            exit;
        }

        try {
            $pdo->beginTransaction();
            $stmt = $pdo->prepare('INSERT INTO messages (from_id, to_id, message) VALUES (?, ?, ?)');
            $stmt->execute([$user_id, $to_id, $message]);
            $msgId = (int)$pdo->lastInsertId();

            foreach ($activeRelationships as $rel) {
                [$normFrom, $normTo] = normalizeFromTo($rel['type'], (int)$rel['from_id'], (int)$rel['to_id']);
                $updateStmt = $pdo->prepare(
                    'UPDATE relationships
                     SET last_msg_id = ?, last_msg_time = NOW(6), updated_at = NOW(6)
                     WHERE id = ? AND deleted_at IS NULL'
                );
                $updateStmt->execute([$msgId, $rel['id']]);
            }

            $pdo->commit();
            echo json_encode(['success' => true]);
        } catch (Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        exit;
    }

    // Sync Read Receipts (Hydration)
    if ($action === "sync_read_receipts") {
        $stmt = $pdo->prepare('SELECT peer_id, last_read_msg_id FROM read_receipts WHERE user_id = ?');
        $stmt->execute([$user_id]);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'receipts' => $data]);
        exit;
    }

    // Mark as Read
    if ($action === "mark_read") {
        $peer_id = (int)($_POST["peer_id"] ?? 0);
        $last_read_id = (int)($_POST["last_read_msg_id"] ?? 0);

        if ($peer_id && $last_read_id > 0) {
            $sql = "INSERT INTO read_receipts (user_id, peer_id, last_read_msg_id) VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE last_read_msg_id = GREATEST(last_read_msg_id, VALUES(last_read_msg_id))";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$user_id, $peer_id, $last_read_id]);
            echo json_encode(['success' => true]);
        } else {
            // It's acceptable to just silently fail or return success for 0
            echo json_encode(['success' => true]);
        }
        exit;
    }

    // Retrieve Message History
    if ($action === "retrieve") {
        $to_id = (int)($_GET["to_id"] ?? 0);
        $before_id = (int)($_GET["before_id"] ?? 0);
        $limit = (int)($_GET["limit"] ?? 50);
        if ($limit <= 0 || $limit > 50) {
            $limit = 50; // Enforce strict cap
        }

        if (!$to_id || !userExists($to_id, $pdo)) {
            http_response_code(404);
            echo json_encode(['error' => 'Target user not found']);
            exit;
        }

        // Relaxed check: Allow viewing history if user was a participant, even if relationship is gone.
        if ($to_id) {
            $selects = [];
            $params = [];

            $baseSelect = "SELECT id, from_id, message, DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%s') AS created_at FROM messages WHERE from_id=? AND to_id=?";

            $selectA = $baseSelect;
            $params[] = $user_id;
            $params[] = $to_id;

            if ($before_id > 0) {
                $selectA .= ' AND id < ?';
                $params[] = $before_id;
            }

            $selects[] = $selectA;

            $selectB = $baseSelect;
            $params[] = $to_id;
            $params[] = $user_id;
            if ($before_id > 0) {
                $selectB .= ' AND id < ?';
                $params[] = $before_id;
            }
            $selects[] = $selectB;

            $sql = '(' . $selects[0] . ') UNION ALL (' . $selects[1] . ') ORDER BY id DESC LIMIT ?';

            $stmt = $pdo->prepare($sql);

            foreach ($params as $k => $v) {
                $stmt->bindValue($k + 1, $v, PDO::PARAM_INT);
            }
            $stmt->bindValue(count($params) + 1, $limit, PDO::PARAM_INT);

            $stmt->execute();
            $results = $stmt->fetchAll();

            // Reverse to Chronological order (Oldest -> Newest) for the frontend to append
            echo json_encode(array_reverse($results));
        } else {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid parameters']);
        }
        exit;
    }
} catch (PDOException $e) {
    error_log('Messages endpoint PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Internal Server Error']);
} catch (Exception $e) {
    error_log('Messages endpoint error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Internal Server Error']);
}
?>