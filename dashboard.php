<?php
// dashboard.php
require_once 'config/version.php';
require_once 'config/db.php';
require_once 'config/csrf.php';

$version = app_version();

if(!isset($_SESSION["user_id"])) {
    header("Location: index.php");
    exit;
}

$csrfToken = generateCsrfToken();

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
    <meta name="csrf-token" content="<?= $csrfToken ?>">
    <title>Gossip Chain 3D</title>
    <link rel="icon" type="image/svg+xml" href="favicon.svg">
    <link rel="stylesheet" href="public/css/style.css?v=<?= $version ?>">

    <script type="importmap">
    {
        "imports": {
            "three": "https://esm.sh/three@0.181.2?dev",
            "three/": "https://esm.sh/three@0.181.2/",
            "three/examples/jsm/": "https://esm.sh/three@0.181.2/examples/jsm/",
            "three/addons/": "https://esm.sh/three@0.181.2/examples/jsm/",
            "three-spritetext": "https://esm.sh/three-spritetext@1.10.0?external=three",
            "3d-force-graph": "https://esm.sh/3d-force-graph@1.79.0?external=three",
            "d3-force-3d": "https://esm.sh/d3-force-3d@3",
            "./public/js/app.js": "./public/js/app.js?v=<?= $version ?>",
            "./public/js/app.js?v=<?= $version ?>": "./public/js/app.js?v=<?= $version ?>",
            "./public/js/api.js": "./public/js/api.js?v=<?= $version ?>",
            "./public/js/api.js?v=<?= $version ?>": "./public/js/api.js?v=<?= $version ?>",
            "./public/js/graph.js": "./public/js/graph.js?v=<?= $version ?>",
            "./public/js/graph.js?v=<?= $version ?>": "./public/js/graph.js?v=<?= $version ?>",
            "./public/js/ui.js": "./public/js/ui.js?v=<?= $version ?>",
            "./public/js/ui.js?v=<?= $version ?>": "./public/js/ui.js?v=<?= $version ?>"
        }
    }
    </script>

    <script type="module">
        import * as THREE from 'three';
        import SpriteText from 'three-spritetext';
        import ForceGraph3D from '3d-force-graph';

        // Expose as globals for app.js
        window.THREE = THREE;
        window.SpriteText = SpriteText;
        window.ForceGraph3D = ForceGraph3D;

        // Signal that libraries are ready
        window.dispatchEvent(new Event('lib-ready'));
    </script>
    <script>
        // Inject configuration from backend
        window.APP_CONFIG = {
            RELATION_TYPES: <?php echo json_encode(RELATION_TYPES, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>,
            RELATION_STYLES: <?php echo json_encode(RELATION_STYLES, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>,
            DIRECTED_RELATION_TYPES: <?php echo json_encode(DIRECTED_RELATION_TYPES, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>,
            VERSION: "<?= $version ?>"
        };
    </script>
</head>
<body>
    <div style="font-family: 'Fredoka'; opacity: 0; position: absolute; pointer-events: none;">.</div>
    <div style="font-family: 'Varela Round'; opacity: 0; position: absolute; pointer-events: none;">.</div>
    <div id="loader"><h2>Connecting to Gossip Neural Net...</h2></div>
    <div id="3d-graph"></div>

    <div style="position: fixed; bottom: 20px; left: 20px; color: rgba(255,255,255,0.4); font-size: 0.8em; font-family: 'Noto Sans SC', sans-serif; pointer-events: none; z-index: 5; user-select: none;">
        Controls: WASD to Move
    </div>

    <div id="connection-panel" class="hud-panel">
        <div class="panel-header">
            <span class="panel-title">Connections</span>
            <button id="conn-toggle-btn" class="panel-toggle">◀</button>
        </div>
        <div id="connection-list"></div>
    </div>

    <div id="search-hud" class="hud-panel command-bar">
        <div class="command-bar-inner search-bar-wrapper">
            <span class="command-icon">🔍</span>
            <div class="command-input-wrap">
                <input type="text" id="search-input" class="search-box" placeholder="Search for a user...">
                <div id="node-count-display" class="badge">Loading...</div>
            </div>
        </div>
        <div id="search-results"></div>
    </div>

    <div id="profile-hud" class="hud-panel identity-card">
        <div class="identity-header profile-header">
            <div class="identity-main">
                <img src="assets/<?= htmlspecialchars($currentUser["avatar"] ?? '0.png') ?>" class="avatar-circle" id="my-avatar">
                <div class="identity-meta">
                    <div class="username-label"><?= htmlspecialchars($currentUser["real_name"] ?? $currentUser["username"]) ?></div>
                    <div class="user-handle">@<?= htmlspecialchars($currentUser["username"]) ?></div>
                    <div class="user-id-label" id="my-user-id">ID: <?= $_SESSION["user_id"] ?></div>
                </div>
            </div>
            <div class="identity-actions">
                <button id="zoom-btn" class="pill-btn primary icon-btn-compact" title="Zoom to Me">🔎</button>
                <form id="logout-form" method="POST" action="logout.php" class="hidden-form">
                    <input type="hidden" name="csrf_token" value="<?= $csrfToken ?>">
                </form>
                <button class="pill-btn secondary icon-btn-compact" type="button" title="Log Out" onclick="document.getElementById('logout-form').submit();">⏻</button>
            </div>
        </div>
        <div class="identity-signature-row">
            <div id="my-signature" class="signature-display"></div>
            <div class="signature-container">
                <textarea id="signature-input" rows="2" placeholder="Update your signature..." maxlength="160"></textarea>
                <div class="signature-row">
                    <div id="signature-counter">0 / 160</div>
                    <button id="signature-update-btn" class="pill-btn primary">Update</button>
                </div>
            </div>
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

    <script type="module">
        import { initApp } from './public/js/app.js?v=<?= $version ?>';
        // Wait for the custom event we added in the head, or fall back to standard load
        function start() {
            // Check if libraries are loaded
            if (window.ForceGraph3D && window.THREE) {
                // Wait for fonts to be ready before initializing to ensure correct rendering
                document.fonts.ready.then(() => {
                    initApp(<?= $_SESSION["user_id"] ?>);
                });
            } else {
                // If libraries aren't ready, listen for the event
                window.addEventListener('lib-ready', () => {
                    document.fonts.ready.then(() => {
                        initApp(<?= $_SESSION["user_id"] ?>);
                    });
                });
            }
        }
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    </script>
</body>
</html>
