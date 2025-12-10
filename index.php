<?php
// gspc2/index.php
require_once 'config/db.php';
require_once 'config/csrf.php';

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
    <title>Social-Demo Login</title>
    <link rel="stylesheet" href="public/css/style.css">
</head>
<body class="login-body">
    <div class="login-container">
        <div class="login-header">
            <h1>Gossip Chain</h1>
            <p>Enter the Neural Network</p>
        </div>

        <!-- Login Section -->
        <div class="login-box">
            <h2>Sign In</h2>
            <?php if(isset($_GET['error'])): ?>
                <div class="alert error">
                    <?php
                        if($_GET['error']=='invalid_credentials') echo "Invalid username or password.";
                        if($_GET['error']=='username_exists') echo "Username already taken.";
                        if($_GET['error']=='unknown') echo "An unknown error occurred.";
                    ?>
                </div>
            <?php endif; ?>
            <?php if(isset($_GET['registered'])) echo '<div class="alert success">Account created! Please login.</div>';?>
            
            <form method="post" action="api/auth.php">
                <input type="hidden" name="csrf_token" value="<?= generateCsrfToken() ?>">
                <input type="hidden" name="action" value="login">

                <div class="form-group">
                    <label>Username</label>
                    <input type="text" name="username" required placeholder="Enter username">
                </div>

                <div class="form-group">
                    <label>Password</label>
                    <input type="password" name="password" required placeholder="Enter password">
                </div>

                <button type="submit" class="btn-primary">Login</button>
            </form>
        </div>

        <div class="divider">
            <span>OR</span>
        </div>

        <!-- Register Section -->
        <div class="login-box register-box">
            <h3>New User? Register</h3>
            <form method="post" action="api/auth.php">
                <input type="hidden" name="csrf_token" value="<?= generateCsrfToken() ?>">
                <input type="hidden" name="action" value="register">

                <div class="form-group">
                    <label>Real Name</label>
                    <input type="text" name="real_name" required placeholder="Enter your real name">
                </div>

                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" name="dob" required>
                </div>

                <div class="form-group">
                    <label>Username</label>
                    <input type="text" name="username" required placeholder="Choose a username">
                </div>

                <div class="form-group">
                    <label>Password</label>
                    <input type="password" name="password" required placeholder="Choose a password">
                </div>

                <div class="form-group">
                    <label>Select Avatar</label>
                    <div class="avatar-selection">
                        <?php foreach(AVATARS as $pic): ?>
                            <label class="avatar-option">
                                <input type="radio" name="avatar" value="<?= htmlspecialchars($pic); ?>" required>
                                <img src="assets/<?= htmlspecialchars($pic); ?>" alt="Avatar">
                            </label>
                        <?php endforeach; ?>
                    </div>
                </div>

                <button type="submit" class="btn-secondary">Create Account</button>
            </form>
        </div>
    </div>
</body>
</html>
