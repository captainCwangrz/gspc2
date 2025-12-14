<?php
// gspc2/index.php
$v = "1.1.0_" . time(); // Ensures fresh load every request
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
    <link rel="stylesheet" href="public/css/style.css?v=<?= $v ?>">
</head>
<body class="login-body">
    <div class="login-container">
        <div class="login-header">
            <h1>Gossip Chain</h1>
            <p>Enter the Gossip Network</p>
        </div>

        <!-- Login Section -->
        <div class="login-box">
            <h2>Sign In</h2>
            <?php if(isset($_GET['error'])): ?>
                <div class="alert error">
                    <?php
                        if($_GET['error']=='invalid_credentials') echo "Invalid username or password.";
                        if($_GET['error']=='username_exists') echo "Username already taken.";
                        if($_GET['error']=='invalid_username_format') echo "Username must be 3-20 chars (letters, numbers, _).";
                        if($_GET['error']=='password_too_short') echo "Password must be at least 8 characters.";
                        if($_GET['error']=='password_mismatch') echo "Passwords do not match.";
                        if($_GET['error']=='name_too_long') echo "Real name is too long.";
                        if($_GET['error']=='invalid_date') echo "Date of birth must be in YYYY-MM-DD format.";
                        if($_GET['error']=='invalid_date_future') echo "Date of birth cannot be in the future.";
                        if($_GET['error']=='invalid_age') echo "You must be between 13 and 120 years old to register.";
                        if($_GET['error']=='missing_fields') echo "Please complete all required fields.";
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
                    <div class="password-wrapper">
                        <input type="password" name="password" required placeholder="Enter password">
                        <button type="button" class="password-toggle-icon" aria-label="Show password">👁️</button>
                    </div>
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
                    <div class="password-wrapper">
                        <input type="password" name="password" required placeholder="Choose a password">
                        <button type="button" class="password-toggle-icon" aria-label="Show password">👁️</button>
                    </div>
                </div>

                <div class="form-group">
                    <label>Confirm Password</label>
                    <div class="password-wrapper">
                        <input type="password" name="confirm_password" required placeholder="Confirm your password">
                        <button type="button" class="password-toggle-icon" aria-label="Show password">👁️</button>
                    </div>
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
    <script>
        const toggleIcons = document.querySelectorAll('.password-toggle-icon');

        toggleIcons.forEach((icon) => {
            const input = icon.closest('.password-wrapper').querySelector('input[type="password"], input[type="text"]');

            const showPassword = () => {
                input.type = 'text';
            };

            const hidePassword = () => {
                input.type = 'password';
            };

            icon.addEventListener('mousedown', showPassword);
            icon.addEventListener('mouseup', hidePassword);
            icon.addEventListener('mouseleave', hidePassword);
            icon.addEventListener('touchstart', (e) => { e.preventDefault(); showPassword(); });
            icon.addEventListener('touchend', (e) => { e.preventDefault(); hidePassword(); });
        });
    </script>
</body>
</html>
