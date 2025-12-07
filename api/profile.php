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

$new_signature = trim($_POST['signature'] ?? '');
$current_user_id = $_SESSION['user_id'];

if (empty($new_signature)) {
    http_response_code(400);
    echo json_encode(['error' => 'Signature cannot be empty.']);
    exit;
}

if (strlen($new_signature) > 255) {
    http_response_code(400);
    echo json_encode(['error' => 'Signature is too long.']);
    exit;
}

try {
    $stmt = $pdo->prepare('UPDATE users SET signature = ? WHERE id = ?');
    $stmt->execute([$new_signature, $current_user_id]);
    echo json_encode(['success' => true, 'message' => 'Signature updated successfully.']);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error: ' . $e->getMessage()]);
}
