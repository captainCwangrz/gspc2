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

    // Retrieve Message History
    if ($action === "retrieve") {
        $to_id = (int)($_GET["to_id"] ?? 0);
        
        // Relaxed check: Allow viewing history if user was a participant, even if relationship is gone.
        // We trust that if a message exists between them, they were once connected.
        if ($to_id) {
            $sql = 'SELECT id, from_id, message, DATE_FORMAT(timestamp, "%Y-%m-%d %H:%i:%s") AS created_at 
                    FROM messages 
                    WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) 
                    ORDER BY id ASC';
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$user_id, $to_id, $to_id, $user_id]);
            echo json_encode($stmt->fetchAll());
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
