<?php
/*
Gossip Chain - 3D Core (Fixed Dependencies & Dynamic Path)
*/
require "config.php";

if(!isset($_SESSION["user_id"])) {
    header("Location: index.php");
    exit;
}

// --- AJAX DATA API MODE ---
if (isset($_GET['ajax']) && $_GET['ajax'] === 'fetch_data') {
    header('Content-Type: application/json');

    try {
        // 1. Fetch Users
        $nodes = $pdo->query('SELECT id, username, avatar, signature FROM users')->fetchAll(PDO::FETCH_ASSOC);
        
        // 2. Fetch Relationships
        $edges = $pdo->query('SELECT from_id, to_id, type FROM relationships')->fetchAll(PDO::FETCH_ASSOC);
        
        // 3. Fetch Incoming Requests
        $stmt = $pdo->prepare(
            'SELECT r.id, r.from_id, r.type, u.username
            FROM requests r
            JOIN users u ON r.from_id = u.id
            WHERE r.to_id = ? AND r.status = "PENDING"
            ORDER BY r.id DESC'
        );
        $stmt->execute([$_SESSION["user_id"]]);
        $requests = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // 4. Format
        $graph_nodes = array_map(function($u){
            return [
                'id' => (int)$u['id'],
                'name' => $u['username'], 
                'avatar' => "assets/" . $u['avatar'], 
                'signature' => $u['signature'] ?? 'No gossip yet.',
                'val' => 1 
            ];
        }, $nodes);

        $graph_edges = array_map(function($e){
            return [
                'source' => (int)$e['from_id'],
                'target' => (int)$e['to_id'],
                'type' => $e['type']
            ];
        }, $edges);

        echo json_encode([
            'nodes' => $graph_nodes,
            'links' => $graph_edges,
            'requests' => $requests
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
    exit;
}

// --- INITIAL LOAD ---
$rel_styles = [
    'DATING' => ['color' => '#ec4899', 'particle' => true, 'label' => '❤️ Dating'],
    'BEST_FRIEND' => ['color' => '#3b82f6', 'particle' => false, 'label' => '💎 Bestie'],
    'BROTHER' => ['color' => '#10b981', 'particle' => false, 'label' => '👊 Bro'],
    'SISTER' => ['color' => '#10b981', 'particle' => false, 'label' => '🌸 Sis'],
    'BEEFING' => ['color' => '#ef4444', 'particle' => true, 'label' => '💀 Beefing'],
    'CRUSH' => ['color' => '#a855f7', 'particle' => true, 'label' => '✨ Crush'],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gossip Chain 3D</title>
    
    <style>
        body { margin: 0; overflow: hidden; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #000; color: white; }
        
        .hud-panel {
            position: absolute;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
            color: #e2e8f0;
            z-index: 10;
        }

        #profile-hud { top: 20px; left: 20px; width: 300px; }
        .user-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .avatar-circle { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid #6366f1; }
        .search-box { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid #334155; padding: 8px; border-radius: 6px; color: white; border:none; outline:none; }

        #notif-hud { top: 20px; right: 20px; width: 280px; max-height: 300px; overflow-y: auto; display: none; }
        .req-item { background: rgba(255,255,255,0.05); padding: 8px; margin-bottom: 8px; border-radius: 6px; font-size: 0.9em; animation: fadeIn 0.5s; }
        .btn-group { margin-top: 6px; display: flex; gap: 8px; }
        .btn { border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: bold; }
        .btn-accept { background: #10b981; color: white; }
        .btn-reject { background: #ef4444; color: white; }

        #chat-hud {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 320px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 15;
            pointer-events: none;
        }
        #chat-hud.has-chat {
            pointer-events: auto;
        }
        .chat-window { pointer-events: auto; height: 250px; background: rgba(15, 23, 42, 0.95); border-radius: 8px; display: flex; flex-direction: column; border: 1px solid #334155; }
        .chat-header { padding: 8px; background: rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
        .chat-msgs { flex: 1; overflow-y: auto; padding: 8px; font-size: 0.9em; }
        .chat-input-area { display: flex; padding: 8px; gap: 4px; border-top: 1px solid #334155; }

        #inspector-panel {
            top: 50%; right: 20px; transform: translateY(-50%);
            width: 300px; display: none; border-left: 4px solid #6366f1;
        }
        .inspector-title { font-size: 1.2em; font-weight: bold; margin-bottom: 4px; color: white; }
        .inspector-subtitle { font-size: 0.9em; color: #94a3b8; margin-bottom: 12px; }
        .inspector-content { font-size: 0.95em; line-height: 1.5; color: #cbd5e1; }
        .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 16px; }
        .stat-box { background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; text-align: center; }
        
        .action-btn { width: 100%; padding: 10px; margin-top: 16px; background: linear-gradient(135deg, #6366f1, #4f46e5); border: none; border-radius: 6px; color: white; font-weight: bold; cursor: pointer; }

        #loader { position: fixed; inset: 0; background: #000; display: flex; justify-content: center; align-items: center; z-index: 9999; transition: opacity 0.5s; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    </style>

    <!-- ThreeJS：明确加载 build 下面给浏览器用的 UMD 版本 -->
    <script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>

    <!-- three-spritetext：用 dist 里的浏览器版 -->
    <script src="https://unpkg.com/three-spritetext@1.8.1/dist/three-spritetext.min.js"></script>

    <!-- 3d-force-graph：同样用 dist 浏览器版 -->
    <script src="https://unpkg.com/3d-force-graph@1.72.3/dist/3d-force-graph.min.js"></script>

</head>
<body>

    <div id="loader"><h2>Connecting to Gossip Neural Net...</h2></div>
    <div id="3d-graph"></div>

    <div id="profile-hud" class="hud-panel">
        <div class="user-header">
            <img src="" class="avatar-circle" id="my-avatar"> 
            <div>
                <div style="font-weight:bold;"><?= htmlspecialchars($_SESSION["username"]) ?></div>
                <div style="font-size:0.8em; color:#94a3b8;">Status: Online</div>
            </div>
        </div>
        <input type="text" id="search-input" class="search-box" placeholder="Search user...">
        <div style="margin-top:8px; display:flex; justify-content:space-between; font-size:0.8em; color:#64748b;">
            <a href="logout.php" style="color:#ef4444; text-decoration:none;">Log Out</a>
            <span id="node-count-display">0 Nodes</span>
        </div>
    </div>

    <div id="notif-hud" class="hud-panel">
        <div style="font-weight:bold; margin-bottom:8px; color:#facc15;">⚠️ Incoming</div>
        <div id="req-list"></div>
    </div>

    <div id="inspector-panel" class="hud-panel">
        <div id="inspector-data"></div>
    </div>

    <div id="chat-hud"></div>

    <script>
    // --- 移除 import 语句，直接使用全局变量 ---
    // import * as THREE from 'three';          <-- 已删除
    // import ForceGraph3D from '3d-force-graph'; <-- 已删除
    // import SpriteText from 'three-spritetext'; <-- 已删除

    // --- CONSTANTS ---
    const CURRENT_USER_ID = <?= $_SESSION["user_id"] ?>;
    const REL_STYLES = <?= json_encode($rel_styles) ?>;
    const POLL_INTERVAL = 3000;

    // --- STATE ---
    let GRAPH_DATA = { nodes: [], links: [] };
    let CURRENT_REQUESTS_HASH = "";
    let highlightNodes = new Set();
    let highlightLinks = new Set();
    let highlightLink = null;
    let isFirstLoad = true;

    // --- INIT GRAPH ---
    const elem = document.getElementById('3d-graph');
    
    // 直接使用全局变量 ForceGraph3D
    const Graph = ForceGraph3D()(elem)
        .backgroundColor('#050505')
        .showNavInfo(false)
        .nodeLabel('name')
        .nodeThreeObject(node => {
            const size = 64; 
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            
            // Placeholder
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2, 0, 2 * Math.PI);
            ctx.fillStyle = node.id === CURRENT_USER_ID ? '#ffffff' : '#1e293b';
            ctx.fill();

            const texture = new THREE.CanvasTexture(canvas); // 使用全局 THREE
            const material = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(16, 16, 1);

            const img = new Image();
            img.crossOrigin = "Anonymous"; 
            img.src = node.avatar;
            
            // 增加图片加载容错
            img.onerror = () => {
                ctx.beginPath();
                ctx.arc(size/2, size/2, size/2, 0, 2 * Math.PI);
                ctx.fillStyle = '#475569';
                ctx.fill();
                ctx.fillStyle = 'white';
                ctx.font = '30px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(node.name.charAt(0).toUpperCase(), size/2, size/2);
                texture.needsUpdate = true;
            };

            img.onload = () => {
                ctx.save();
                ctx.beginPath();
                ctx.arc(size/2, size/2, size/2 - 2, 0, 2 * Math.PI);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(img, 0, 0, size, size);
                ctx.restore();
                ctx.beginPath();
                ctx.arc(size/2, size/2, size/2 - 2, 0, 2 * Math.PI);
                ctx.lineWidth = 4;
                ctx.strokeStyle = node.id === CURRENT_USER_ID ? '#6366f1' : '#475569';
                ctx.stroke();
                texture.needsUpdate = true;
            };
            return sprite;
        })
        .linkWidth(link => link === highlightLink ? 2 : 1)
        .linkColor(link => {
            if (highlightNodes.size > 0 && !highlightLinks.has(link)) return 'rgba(255,255,255,0.05)';
            const style = REL_STYLES[link.type];
            return style ? style.color : '#cbd5e1';
        })
        .linkDirectionalParticles(link => {
            const style = REL_STYLES[link.type];
            return (style && style.particle) ? 3 : 0;
        })
        .linkDirectionalParticleWidth(2)
        .linkThreeObjectExtend(true)
        .linkThreeObject(link => {
            const style = REL_STYLES[link.type];
            // 直接使用全局 SpriteText
            const sprite = new SpriteText(style ? style.label : link.type);
            sprite.color = style ? style.color : 'lightgrey';
            sprite.textHeight = 3;
            sprite.backgroundColor = 'rgba(0,0,0,0.5)';
            sprite.padding = 2;
            return sprite;
        })
        .linkPositionUpdate((sprite, { start, end }) => {
            const middlePos = Object.assign(...['x', 'y', 'z'].map(c => ({
                [c]: start[c] + (end[c] - start[c]) / 2 
            }))); 
            Object.assign(sprite.position, middlePos);
        })
        .onNodeClick(handleNodeClick)
        .onLinkClick(handleLinkClick)
        .onBackgroundClick(resetFocus);

    // --- ZOOM CONTROLS ---
    // 由于只有这一个 Three.js 实例，Graph.controls() 不会再报错了
    const controls = Graph.controls();
    if (controls) {
        controls.minDistance = 50;
        controls.maxDistance = 1500;
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
    }

    // --- STARFIELD ---
    setTimeout(() => {
        const scene = Graph.scene();
        const starsGeo = new THREE.BufferGeometry(); // 使用全局 THREE
        const starCount = 3000;
        const posArray = new Float32Array(starCount * 3);
        for(let i=0; i<starCount*3; i++) posArray[i] = (Math.random() - 0.5) * 5000;
        starsGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const starsMat = new THREE.PointsMaterial({size: 2, color: 0xffffff, transparent: true, opacity: 0.5 });
        const starField = new THREE.Points(starsGeo, starsMat);
        scene.add(starField);
    }, 1000);

    // ... (剩下的 fetchData, updateRequestsUI 等函数代码保持不变，不需要修改) ...
    // ... 为了节省篇幅，这里只要把原文件中剩下的函数复制过来即可 ...
    
    // 请确保包含原来代码中的:
    // async function fetchData() { ... }
    // function updateRequestsUI(requests) { ... }
    // fetchData();
    // setInterval(fetchData, POLL_INTERVAL);
    // function handleNodeClick(node) { ... }
    // function handleLinkClick(link) { ... }
    // function resetFocus() { ... }
    // 以及所有的 window.xxx 函数
    
    // 注意：在 handleNodeClick 中，v.clone() 和 new THREE.Vector3() 也会正常工作，因为 THREE 是全局的。
    
    // --- 剩下的代码 ---
    async function fetchData() {
        try {
            const response = await fetch('?ajax=fetch_data');
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) return;

            const data = await response.json();
            updateRequestsUI(data.requests);

            const newNodesJson = JSON.stringify(data.nodes);
            const oldNodesJson = JSON.stringify(GRAPH_DATA.nodes.map(n => ({
                id: n.id, name: n.name, avatar: n.avatar, signature: n.signature, val: n.val
            })));
            const newLinksJson = JSON.stringify(data.links);
            const oldLinksJson = JSON.stringify(GRAPH_DATA.links.map(l => ({
                source: (typeof l.source === 'object' ? l.source.id : l.source),
                target: (typeof l.target === 'object' ? l.target.id : l.target),
                type: l.type
            })));

            if (isFirstLoad || newNodesJson !== oldNodesJson || newLinksJson !== oldLinksJson) {
                if (!isFirstLoad) {
                    const oldPosMap = new Map();
                    GRAPH_DATA.nodes.forEach(n => {
                        if (n.x !== undefined) oldPosMap.set(n.id, {x:n.x, y:n.y, z:n.z, vx:n.vx, vy:n.vy, vz:n.vz});
                    });
                    data.nodes.forEach(n => {
                        const old = oldPosMap.get(n.id);
                        if (old) Object.assign(n, old);
                    });
                }

                GRAPH_DATA = { nodes: data.nodes, links: data.links };
                Graph.graphData(GRAPH_DATA);
                
                const myNode = data.nodes.find(n => n.id === CURRENT_USER_ID);
                if(myNode && isFirstLoad) document.getElementById('my-avatar').src = myNode.avatar;
                document.getElementById('node-count-display').innerText = `${data.nodes.length} Nodes`;

                if(isFirstLoad) {
                    const l = document.getElementById('loader');
                    l.style.opacity = '0';
                    setTimeout(() => l.style.display = 'none', 500);
                    isFirstLoad = false;
                }
            }
        } catch (e) { console.error("Polling error:", e); }
    }

    function updateRequestsUI(requests) {
        const container = document.getElementById('notif-hud');
        const list = document.getElementById('req-list');
        const reqHash = JSON.stringify(requests);
        if(reqHash === CURRENT_REQUESTS_HASH) return;
        CURRENT_REQUESTS_HASH = reqHash;

        if(requests.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';
        list.innerHTML = requests.map(r => `
            <div class="req-item">
                <strong>${escapeHtml(r.username)}</strong> &rarr; ${r.type}
                <div class="btn-group">
                    <button class="btn btn-accept" onclick="window.acceptReq(${r.id})">Accept</button>
                    <button class="btn btn-reject" onclick="window.rejectReq(${r.id})">Deny</button>
                </div>
            </div>
        `).join('');
    }

    fetchData(); 
    setInterval(fetchData, POLL_INTERVAL);

    function handleNodeClick(node) {
        const dist = 150;
        const v = new THREE.Vector3(node.x, node.y, node.z); // 使用全局 THREE
        if (v.lengthSq() === 0) v.set(0, 0, 1);
        
        const camPos = v.clone().normalize().multiplyScalar(dist).add(v);
        camPos.y += 40; 

        Graph.cameraPosition(
            { x: camPos.x, y: camPos.y, z: camPos.z },
            node, 
            1500
        );

        highlightNodes.clear();
        highlightLinks.clear();
        highlightNodes.add(node);
        
        const links = Graph.graphData().links;
        links.forEach(link => {
            const sId = typeof link.source === 'object' ? link.source.id : link.source;
            const tId = typeof link.target === 'object' ? link.target.id : link.target;
            
            if (sId === node.id || tId === node.id) {
                highlightLinks.add(link);
                highlightNodes.add(sId === node.id ? link.target : link.source);
            }
        });

        Graph.nodeColor(Graph.nodeColor());
        Graph.linkColor(Graph.linkColor());

        showNodeInspector(node);
    }

    function handleLinkClick(link) {
        highlightLinks.clear();
        highlightLinks.add(link);
        highlightLink = link;
        Graph.linkColor(Graph.linkColor());
        showLinkInspector(link);
    }

    function resetFocus() {
        highlightNodes.clear();
        highlightLinks.clear();
        highlightLink = null;
        Graph.cameraPosition({ x: 0, y: 0, z: 800 }, { x: 0, y: 0, z: 0 }, 1500);
        document.getElementById('inspector-panel').style.display = 'none';
    }

    function escapeHtml(text) {
        if (!text) return text;
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function showNodeInspector(node) {
        const panel = document.getElementById('inspector-panel');
        const dataDiv = document.getElementById('inspector-data');
        panel.style.display = 'block';

        const links = Graph.graphData().links;
        const relationsCount = links.filter(l => {
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            return sId === node.id || tId === node.id;
        }).length;
        
        let actionHtml = '';
        if(node.id !== CURRENT_USER_ID) {
            const myRel = links.find(l => {
                const sId = typeof l.source === 'object' ? l.source.id : l.source;
                const tId = typeof l.target === 'object' ? l.target.id : l.target;
                return (sId === node.id && tId === CURRENT_USER_ID) || 
                       (tId === node.id && sId === CURRENT_USER_ID);
            });
            const safeName = encodeURIComponent(node.name);

            if(myRel) {
                actionHtml = `
                    <div style="margin-top:10px; padding:8px; background:rgba(255,255,255,0.1); border-radius:4px;">
                        Status: <strong style="color:${REL_STYLES[myRel.type]?.color}">${myRel.type}</strong>
                    </div>
                    <button class="action-btn" onclick="window.openChat(${node.id}, '${safeName}')">💬 Message</button>
                    <button class="action-btn" style="background:#ef4444; margin-top:8px;" onclick="window.removeRel(${node.id})">💔 Remove</button>
                `;
            } else {
                actionHtml = `
                    <select id="req-type" style="width:100%; padding:8px; margin-top:10px; background:#1e293b; color:white; border:1px solid #475569; border-radius:4px;">
                        <option value="DATING">Request Dating</option>
                        <option value="BEEFING">Start Beefing</option>
                        <option value="BEST_FRIEND">Add Bestie</option>
                        <option value="CRUSH">Confess Crush</option>
                    </select>
                    <button class="action-btn" onclick="window.sendRequest(${node.id})">🚀 Send Request</button>
                `;
            }
        }

        dataDiv.innerHTML = `
            <img src="${node.avatar}" style="width:80px; height:80px; border-radius:50%; margin:0 auto 10px; display:block; border:3px solid #6366f1;">
            <div class="inspector-title" style="text-align:center">${escapeHtml(node.name)}</div>
            <div class="inspector-subtitle" style="text-align:center">User ID: ${node.id}</div>
            <div class="inspector-content" style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px;">
                <em>"${escapeHtml(node.signature)}"</em>
            </div>
            <div class="stat-grid">
                <div class="stat-box">
                    <div class="stat-val">${relationsCount}</div>
                    <div class="stat-label">Connections</div>
                </div>
            </div>
            ${actionHtml}
        `;
    }

    function showLinkInspector(link) {
        const panel = document.getElementById('inspector-panel');
        const dataDiv = document.getElementById('inspector-data');
        panel.style.display = 'block';
        const style = REL_STYLES[link.type];
        dataDiv.innerHTML = `
            <div class="inspector-title" style="color:${style.color}; text-align:center;">${style.label}</div>
            <div style="display:flex; justify-content:space-around; align-items:center; margin: 20px 0;">
                <div style="text-align:center">
                    <img src="${link.source.avatar}" style="width:40px; height:40px; border-radius:50%;">
                    <div style="font-size:0.8em;">${escapeHtml(link.source.name)}</div>
                </div>
                <div style="font-size:1.5em; opacity:0.5;">↔️</div>
                <div style="text-align:center">
                    <img src="${link.target.avatar}" style="width:40px; height:40px; border-radius:50%;">
                    <div style="font-size:0.8em;">${escapeHtml(link.target.name)}</div>
                </div>
            </div>
        `;
    }

    // --- GLOBAL ACTIONS ---
    window.sendRequest = function(toId) {
        const type = document.getElementById('req-type').value;
        postData({ action: 'request', to_id: toId, type: type })
            .then(() => { alert('Request Sent!'); fetchData(); });
    };

    window.acceptReq = function(reqId) { postData({ action: 'accept_request', request_id: reqId }).then(fetchData); };
    window.rejectReq = function(reqId) { postData({ action: 'reject_request', request_id: reqId }).then(fetchData); };
    window.removeRel = function(toId) { if(!confirm("Are you sure?")) return; postData({ action: 'remove', to_id: toId }).then(fetchData); };

    function postData(data) {
        const fd = new FormData();
        for(let k in data) fd.append(k, data[k]);
        return fetch('relationships.php', { method: 'POST', body: fd });
    }

    window.openChat = function(userId, encodedName) {

        const userName = decodeURIComponent(encodedName);
        const chatHud = document.getElementById('chat-hud');
        chatHud.classList.add('has-chat');
        if(document.getElementById(`chat-${userId}`)) return;

        const div = document.createElement('div');
        div.id = `chat-${userId}`;
        div.className = 'chat-window';
        div.innerHTML = `
            <div class="chat-header">
                <span>${escapeHtml(userName)}</span>
                <span style="cursor:pointer; color:#ef4444;" onclick="document.getElementById('chat-${userId}').remove()">✕</span>
            </div>
            <div class="chat-msgs" id="msgs-${userId}">Loading...</div>
            <form class="chat-input-area" onsubmit="window.sendMsg(event, ${userId})">
                <input type="text" style="flex:1; background:none; border:none; color:white; outline:none;" placeholder="Message..." required>
                <button style="background:none; border:none; color:#6366f1; cursor:pointer;">Send</button>
            </form>
        `;
        chatHud.appendChild(div);
        window.loadMsgs(userId);
        
        const interval = setInterval(() => {
            if(!document.getElementById(`chat-${userId}`)) clearInterval(interval);
            else window.loadMsgs(userId);
        }, 3000);
    };

    window.loadMsgs = function(userId) {
        const container = document.getElementById(`msgs-${userId}`);
        if(!container) return;
        fetch(`direct_message.php?action=retrieve&to_id=${userId}`)
        .then(r => r.json())
        .then(data => {
            container.innerHTML = data.map(m => `
                <div style="text-align:${m.from_id == CURRENT_USER_ID ? 'right' : 'left'}; margin-bottom:4px;">
                    <span style="background:${m.from_id == CURRENT_USER_ID ? '#6366f1' : '#334155'}; padding:4px 8px; border-radius:4px; display:inline-block;">
                        ${escapeHtml(m.message)}
                    </span>
                </div>
            `).join('');
            container.scrollTop = container.scrollHeight;
        });
    };

    window.sendMsg = function(e, userId) {
        e.preventDefault();
        const input = e.target.querySelector('input');
        const msg = input.value;
        if(!msg) return;
        
        const fd = new FormData();
        fd.append('action', 'send');
        fd.append('to_id', userId);
        fd.append('message', msg);
        
        fetch('direct_message.php', { method:'POST', body:fd })
        .then(() => {
            input.value = '';
            window.loadMsgs(userId);
        });
    };

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('change', (e) => {
            const val = e.target.value.toLowerCase();
            const node = GRAPH_DATA.nodes.find(n => n.name.toLowerCase().includes(val));
            if(node) handleNodeClick(node);
        });
    }
</script>
</body>
</html>