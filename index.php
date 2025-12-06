<?php
// gspc2/index.php
// 修正：引用 config 目录下的 db.php
require_once 'config/db.php';

if(isset($_SESSION["user_id"])) {
    header("Location: dashboard.php");
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Social-Demo</title>
    <link rel="stylesheet" href="public/css/style.css">
    <style>
        /* 仅保留登录页特有的少量样式，其余复用 style.css */
        body { background-color: #0f172a; color: white; display:flex; justify-content:center; align-items:center; height:100vh; overflow:auto; }
        .box { background: rgba(30, 41, 59, 0.8); padding: 2rem; border-radius: 12px; border: 1px solid #334155; width: 350px; }
        input { background: rgba(0,0,0,0.3); border: 1px solid #475569; color: white; border-radius: 4px; margin-bottom: 10px; box-sizing: border-box;}
        button { background: #6366f1; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer; font-weight: bold; margin-left:0; margin-top:10px;}
        button:hover { background: #4f46e5; }
        label { color: #cbd5e1; font-size: 0.9em; }
        hr { border-color: #334155; margin: 20px 0; }
        .error { color: #ef4444; background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 4px; font-size: 0.9em; margin-bottom: 10px; }
        .registered { color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 8px; border-radius: 4px; font-size: 0.9em; margin-bottom: 10px; }
        .avatar-option { display:inline-block; margin: 5px; cursor:pointer; }
        .avatar-option input { display:none; }
        .avatar-option img { border: 2px solid transparent; border-radius: 50%; transition: 0.2s; }
        .avatar-option input:checked + img { border-color: #6366f1; transform: scale(1.1); }
    </style>
</head>
<body>
    <div class="box">
        <h2 style="margin-top:0;">Sign In</h2>
        
        <?php if(isset($_GET['error'])): ?>
            <p class="error">
                <?php 
                    if($_GET['error']=='invalid_credentials') echo "Invalid username or password.";
                    if($_GET['error']=='username_exists') echo "Username already taken.";
                ?>
            </p>
        <?php endif; ?>
        <?php if(isset($_GET['registered'])) echo '<p class="registered">Account created! Please login.</p>';?>
        
        <form method="post" action="api/auth.php">
            <input type="hidden" name="action" value="login">
            <label>Username</label>
            <input type="text" name="username" required>
            <label>Password</label>
            <input type="password" name="password" required>
            <button type="submit">Login</button>
        </form>

        <hr>
        
        <h3 style="margin-top:0;">Register</h3>
        <form method="post" action="api/auth.php">
            <input type="hidden" name="action" value="register">
            <label>Username</label>
            <input type="text" name="username" required>
            <label>Password</label>
            <input type="password" name="password" required>
            
            <div style="margin: 10px 0;">
                <label>Select Avatar:</label><br>
                <?php foreach(AVATARS as $pic): ?>
                    <label class="avatar-option">
                        <input type="radio" name="avatar" value="<?= htmlspecialchars($pic); ?>">
                        <img src="assets/<?= htmlspecialchars($pic); ?>" width="40">
                    </label>
                <?php endforeach; ?>
            </div>
            <button type="submit" style="background:#10b981;">Create Account</button>
        </form>
    </div>
</body>
</html>