<?php
// dashboard.php
require_once 'config/db.php';
require_once 'config/csrf.php';

if(!isset($_SESSION["user_id"])) {
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
</head>
<body>

    <div id="loader"><h2>Connecting to Gossip Neural Net...</h2></div>
    <div id="3d-graph"></div>

    <div id="profile-hud" class="hud-panel">
        <div class="user-header">
            <img src="assets/<?= htmlspecialchars($_SESSION["avatar"] ?? '0.png') ?>" class="avatar-circle" id="my-avatar">
            <div>
                <div style="font-weight:bold;"><?= htmlspecialchars($_SESSION["username"]) ?></div>
                <div style="font-size:0.8em; color:#94a3b8;">Status: Online</div>
            </div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:10px;">
            <a href="logout.php" style="color:#ef4444; text-decoration:none;">Log Out</a>
            <span id="node-count-display">Loading...</span>
        </div>
    </div>

    <div id="notif-hud" class="hud-panel">
        <div style="font-weight:bold; margin-bottom:8px; color:#facc15;">⚠️ Incoming Requests</div>
        <div id="req-list"></div>
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