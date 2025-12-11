<?php
// config/auth.php
require_once __DIR__ . '/db.php';

function require_login() {
    if (session_status() === PHP_SESSION_NONE) session_start();
    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        exit(json_encode(['error' => 'Unauthorized']));
    }
}
