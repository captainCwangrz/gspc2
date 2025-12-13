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
    if (!preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username)) {
        header("Location: ../index.php?error=invalid_username_format");
        exit;
    }

    if (strlen($password) < 8) {
        header("Location: ../index.php?error=password_too_short");
        exit;
    }

    $stmt = $pdo->prepare('SELECT id, username, real_name, password_hash, avatar FROM users WHERE username=?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user["password_hash"])) {
        session_regenerate_id(true);
        $_SESSION["user_id"] = $user["id"];
        $_SESSION["username"] = $user["username"];
        $_SESSION["real_name"] = $user["real_name"];
        $_SESSION["avatar"] = $user["avatar"]; // 存一下头像备用
        header("Location: ../dashboard.php");
        exit;
    }
    header("Location: ../index.php?error=invalid_credentials");
    exit;
}

if ($action === "register") {
    $real_name = trim($_POST["real_name"] ?? "");
    $dob = $_POST["dob"] ?? "";
    $confirm_password = $_POST["confirm_password"] ?? "";

    if (!$username || !$password || !$real_name || !$dob) {
        header("Location: ../index.php?error=missing_fields");
        exit;
    }

    if (!preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username)) {
        header("Location: ../index.php?error=invalid_username_format");
        exit;
    }

    if (strlen($password) < 8) {
        header("Location: ../index.php?error=password_too_short");
        exit;
    }

    if ($password !== $confirm_password) {
        header("Location: ../index.php?error=password_mismatch");
        exit;
    }

    $realNameLength = function_exists('mb_strlen') ? mb_strlen($real_name, 'UTF-8') : strlen($real_name);
    if ($realNameLength > 50) {
        header("Location: ../index.php?error=name_too_long");
        exit;
    }

    // Validate DOB (Strict YYYY-MM-DD)
    $d = DateTime::createFromFormat('Y-m-d', $dob);
    if (!$d || $d->format('Y-m-d') !== $dob) {
        header("Location: ../index.php?error=invalid_date");
        exit;
    }

    $now = new DateTime();
    $age = $now->diff($d)->y;

    if ($d > $now) {
        header("Location: ../index.php?error=invalid_date_future");
        exit;
    }

    if ($age < 13 || $age > 120) {
        header("Location: ../index.php?error=invalid_age");
        exit;
    }

    $avatar = $_POST["avatar"] ?? FALLBACK_AVATAR;
    if (!in_array($avatar, AVATARS)) $avatar = FALLBACK_AVATAR;

    $password_hash = password_hash($password, PASSWORD_DEFAULT);

    // Removed random coordinate generation, using 0,0 as placeholders
    // The frontend engine will handle positioning
    try {
        $stmt = $pdo->prepare('INSERT INTO users (username, real_name, dob, password_hash, avatar) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$username, $real_name, $dob, $password_hash, $avatar]);
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