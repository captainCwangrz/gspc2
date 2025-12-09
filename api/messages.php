<?php
// gspc2/api/messages.php
require_once '../config/db.php';
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
session_write_close(); // Unblock session

$action = $_POST["action"] ?? $_GET["action"] ?? "";

// Helper: Check if active relationship exists
function checkRelationship(int $from_id, int $to_id, PDO $pdo): bool {
    if ($from_id === $to_id) return false;
    $sql = 'SELECT id FROM relationships WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$from_id, $to_id, $to_id, $from_id]);
    return (bool) $stmt->fetchColumn();
}

try {
    // Send Message
    if ($action === "send") {
        $to_id = (int)($_POST["to_id"] ?? 0);
        $message = trim($_POST["message"] ?? "");

        // Strict check: Must have active relationship to send
        if ($to_id && $message !== "" && checkRelationship($user_id, $to_id, $pdo)) {
            $stmt = $pdo->prepare('INSERT INTO messages (from_id, to_id, message) VALUES (?, ?, ?)');
            $stmt->execute([$user_id, $to_id, $message]);
            echo json_encode(['success' => true]);
        } else {
            // Determine detailed error
            if (!$to_id || $message === "") {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid parameters']);
            } else {
                // No relationship
                http_response_code(403);
                echo json_encode(['error' => 'Relationship required to send messages']);
            }
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
        if ($limit > 100) $limit = 100; // Hard cap limit

        // Relaxed check: Allow viewing history if user was a participant, even if relationship is gone.
        if ($to_id) {
            $params = [$user_id, $to_id, $to_id, $user_id];
            $whereClause = '((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))';

            if ($before_id > 0) {
                $whereClause .= ' AND id < ?';
                $params[] = $before_id;
            }

            // Optimization: Get latest messages by ordering DESC first, then re-sort PHP side if needed?
            // Actually, for "scroll up", we usually want the "latest 50 messages before X".
            // So ORDER BY id DESC LIMIT 50 is correct, then we reverse the array for display.

            $sql = "SELECT id, from_id, message, DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%s') AS created_at
                    FROM messages 
                    WHERE $whereClause
                    ORDER BY id DESC LIMIT ?";

            // Limit must be integer for PDO emulation usually, but better bind it explicitly
            $stmt = $pdo->prepare($sql);

            // Bind params
            foreach ($params as $k => $v) {
                $stmt->bindValue($k+1, $v, PDO::PARAM_INT);
            }
            $stmt->bindValue(count($params)+1, $limit, PDO::PARAM_INT);

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
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>