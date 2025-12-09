<?php
// api/auth.php
require_once '../config/db.php';
require_once '../config/csrf.php';

$action = $_POST["action"] ?? "";

// CSRF Check for Auth actions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!validateCsrfToken($_POST['csrf_token'] ?? '')) {
        die("Invalid CSRF Token");
    }
}

$username = trim($_POST["username"] ?? "");
$password = $_POST["password"] ?? "";

if ($action === "login") {
    $stmt = $pdo->prepare('SELECT id, username, password_hash, avatar FROM users WHERE username=?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user["password_hash"])) {
        $_SESSION["user_id"] = $user["id"];
        $_SESSION["username"] = $user["username"];
        $_SESSION["avatar"] = $user["avatar"]; // 存一下头像备用
        header("Location: ../dashboard.php");
        exit;
    }
    header("Location: ../index.php?error=invalid_credentials");
    exit;
}

if ($action === "register") {
    if (!$username || !$password) exit("Missing fields!");

    $avatar = $_POST["avatar"] ?? FALLBACK_AVATAR;
    if (!in_array($avatar, AVATARS)) $avatar = FALLBACK_AVATAR;

    $password_hash = password_hash($password, PASSWORD_DEFAULT);

    // Removed random coordinate generation, using 0,0 as placeholders
    // The frontend engine will handle positioning
    try {
        $stmt = $pdo->prepare('INSERT INTO users (username, password_hash, x_pos, y_pos, avatar) VALUES (?, ?, 0, 0, ?)');
        $stmt->execute([$username, $password_hash, $avatar]);
    } catch (PDOException $e) {
        if ($e->getCode() === "23000" && strpos($e->getMessage(), "username") !== false) {
            header("Location: ../index.php?error=username_exists");
            exit;
        }
        throw $e;
    }

    header("Location: ../index.php?registered=1");
    exit;
}