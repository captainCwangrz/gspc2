<?php
// api/auth.php
require_once '../config/db.php';

$action = $_POST["action"] ?? "";
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
    
    // 简单的随机坐标生成
    $range = 1000; 
    $success = false;
    
    do {
        $x = (mt_rand() / mt_getrandmax() * 2 - 1) * $range;
        $y = (mt_rand() / mt_getrandmax() * 2 - 1) * $range;
        try {
            $stmt = $pdo->prepare('INSERT INTO users (username, password_hash, x_pos, y_pos, avatar) VALUES (?, ?, ?, ?, ?)');
            $stmt->execute([$username, $password_hash, $x, $y, $avatar]);
            $success = true;
        } catch (PDOException $e) {
            if ($e->getCode() !== "23000") throw $e; // 非重复错误则抛出
            // 如果是用户名重复
            if (strpos($e->getMessage(), "username") !== false) {
                header("Location: ../index.php?error=username_exists");
                exit;
            }
        }
    } while (!$success);

    header("Location: ../index.php?registered=1");
    exit;
}