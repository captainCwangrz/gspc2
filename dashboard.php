<?php
// dashboard.php
require_once 'config/db.php';
require_once 'config/csrf.php';

if(!isset($_SESSION["user_id"])) {
    header("Location: index.php");
    exit;
}

// Fetch fresh user data
$stmt = $pdo->prepare("SELECT username, real_name, avatar FROM users WHERE id = ?");
$stmt->execute([$_SESSION['user_id']]);
$currentUser = $stmt->fetch();

if (!$currentUser) {
    session_destroy();
    header("Location: index.php");
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="<?= generateCsrfToken() ?>">
    <title>Gossip Chain 3D</title>
    <link rel="stylesheet" href="public/css/style.css">

    <script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
    <script src="https://unpkg.com/three-spritetext@1.8.1/dist/three-spritetext.min.js"></script>
    <script src="https://unpkg.com/3d-force-graph@1.72.3/dist/3d-force-graph.min.js"></script>
    <script>
        // Inject configuration from backend
        window.APP_CONFIG = {
            RELATION_TYPES: <?php echo json_encode(RELATION_TYPES); ?>,
            RELATION_STYLES: <?php echo json_encode(RELATION_STYLES); ?>
        };
    </script>
</head>
<body>
    <div id="loader"><h2>Connecting to Gossip Neural Net...</h2></div>
    <div id="3d-graph"></div>

    <div id="search-hud" class="hud-panel">
        <input type="text" id="search-input" class="search-box" placeholder="Search for a user...">
        <div id="search-results"></div>
        <div id="node-count-display" style="text-align: right; margin-top: 5px; font-size: 0.8em; color: #94a3b8;">Loading...</div>
    </div>

    <div id="profile-hud" class="hud-panel">
        <div class="user-header">
            <img src="assets/<?= htmlspecialchars($currentUser["avatar"] ?? '0.png') ?>" class="avatar-circle" id="my-avatar">
            <div>
                <div class="username-label"><?= htmlspecialchars($currentUser["real_name"] ?? $currentUser["username"]) ?></div>
                <div style="font-size: 0.8em; color: #94a3b8;">@<?= htmlspecialchars($currentUser["username"]) ?></div>
                <div class="user-id-label" id="my-user-id" style="font-size: 0.8em; color: #94a3b8;">ID: <?= $_SESSION["user_id"] ?></div>
            </div>
        </div>
        <div id="my-signature" class="signature-display" style="margin-bottom: 10px; font-style: italic; color: #cbd5e1; font-size: 0.9em;"></div>
        <div class="signature-container">
            <textarea id="signature-input" rows="3" placeholder="Update your signature..." maxlength="160"></textarea>
            <div id="signature-counter" style="text-align: right; color: #94a3b8; font-size: 0.8em; margin-bottom: 5px;">0 / 160</div>
            <button id="signature-update-btn">Update Signature</button>
        </div>
        <div class="logout-container">
            <button id="zoom-btn" class="action-btn" style="background: #3b82f6;">Zoom to Me</button>
            <a href="logout.php" class="logout-link btn-secondary" style="text-decoration: none; text-align: center;">Log Out</a>
        </div>
    </div>

    <div id="notif-hud" class="hud-panel">
        <div id="toast-list"></div>
        <div id="requests-container" style="display:none;">
            <div class="requests-header">⚠️ Incoming Requests</div>
            <div id="req-list"></div>
        </div>
        <div id="unread-msgs-container" class="unread-messages-container" style="display:none;">
             <div class="unread-messages-header">📬 Unread Messages</div>
             <div id="unread-msgs-list"></div>
        </div>
    </div>

    <div id="inspector-panel" class="hud-panel">
        <div id="inspector-data"></div>
    </div>

    <div id="chat-hud"></div>

    <script src="public/js/app.js"></script>
    <script>
        // Bootstrap the app with PHP session data
        document.addEventListener('DOMContentLoaded', () => {
            initApp(<?= $_SESSION["user_id"] ?>);
        });
    </script>
</body>
</html>