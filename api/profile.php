<?php
// api/profile.php
require_once '../config/db.php';
require_once '../config/csrf.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_SESSION["user_id"])) {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

if (!validateCsrfToken($_POST['csrf_token'] ?? '')) {
    http_response_code(403);
    die(json_encode(['error' => 'Invalid CSRF Token']));
}

$user_id = $_SESSION["user_id"];
session_write_close(); // Prevent blocking

$new_signature = trim($_POST['signature'] ?? '');

// Sanitization
$new_signature = htmlspecialchars($new_signature, ENT_QUOTES, 'UTF-8');

if (empty($new_signature)) {
    http_response_code(400);
    echo json_encode(['error' => 'Signature cannot be empty.']);
    exit;
}

// Length check (DB limit is usually 160 or 255 depending on setup, user said 255 but db.php says 160)
// Checking db.php: signature VARCHAR(160)
if (mb_strlen($new_signature) > 160) {
    $new_signature = mb_substr($new_signature, 0, 160);
}

try {
    $stmt = $pdo->prepare('UPDATE users SET signature = ? WHERE id = ?');
    $stmt->execute([$new_signature, $user_id]);
    updateSystemState($pdo);
    echo json_encode(['success' => true, 'message' => 'Signature updated successfully.']);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error: ' . $e->getMessage()]);
}
