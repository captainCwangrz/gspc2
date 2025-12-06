/**
 * Gossip Chain 3D - Main Application Logic
 * refactored for gspc2
 */

// --- Configuration ---
const CONFIG = {
    pollInterval: 3000,
    relStyles: {
        'DATING': { color: '#ec4899', particle: true, label: '❤️ Dating' },
        'BEST_FRIEND': { color: '#3b82f6', particle: false, label: '💎 Bestie' },
        'BROTHER': { color: '#10b981', particle: false, label: '👊 Bro' },
        'SISTER': { color: '#10b981', particle: false, label: '🌸 Sis' },
        'BEEFING': { color: '#ef4444', particle: true, label: '💀 Beefing' },
        'CRUSH': { color: '#a855f7', particle: true, label: '✨ Crush' }
    }
};

// --- Global State ---
const State = {
    userId: null,
    graphData: { nodes: [], links: [] },
    reqHash: "",
    highlightNodes: new Set(),
    highlightLinks: new Set(),
    highlightLink: null,
    isFirstLoad: true,
    chatIntervals: {} // Store chat polling intervals
};

// Graph Instance
let Graph = null;

/**
 * Initialize the Application
 * Called from dashboard.php
 */
function initApp(userId) {
    State.userId = userId;
    const elem = document.getElementById('3d-graph');

    // Initialize 3D Force Graph
    Graph = ForceGraph3D()(elem)
        .backgroundColor('#050505')
        .showNavInfo(false)
        .nodeLabel('name')
        .nodeThreeObject(nodeRenderer)
        .linkWidth(link => link === State.highlightLink ? 2 : 1)
        .linkColor(link => {
            if (State.highlightNodes.size > 0 && !State.highlightLinks.has(link)) return 'rgba(255,255,255,0.05)';
            return CONFIG.relStyles[link.type]?.color || '#cbd5e1';
        })
        .linkDirectionalParticles(link => {
            const style = CONFIG.relStyles[link.type];
            return (style && style.particle) ? 3 : 0;
        })
        .linkDirectionalParticleWidth(2)
        .linkThreeObjectExtend(true)
        .linkThreeObject(linkRenderer)
        .linkPositionUpdate((sprite, { start, end }) => {
            const middlePos = Object.assign(...['x', 'y', 'z'].map(c => ({
                [c]: start[c] + (end[c] - start[c]) / 2
            })));
            Object.assign(sprite.position, middlePos);
        })
        .onNodeClick(handleNodeClick)
        .onLinkClick(handleLinkClick)
        .onBackgroundClick(resetFocus);

    // Zoom Controls
    const controls = Graph.controls();
    if (controls) {
        controls.minDistance = 50;
        controls.maxDistance = 1500;
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
    }

    // Initialize Search Listener
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            const node = State.graphData.nodes.find(n => n.name.toLowerCase().includes(val));
            if(node) handleNodeClick(node);
        });
    }

    // Start Loops
    fetchData();
    setInterval(fetchData, CONFIG.pollInterval);
    initStarfield();
}

/**
 * Custom Node Renderer (Canvas Sprite)
 */
function nodeRenderer(node) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const draw = (img) => {
        ctx.clearRect(0,0,size,size);

        // Background circle
        ctx.beginPath();
        ctx.arc(size/2, size/2, size/2, 0, 2 * Math.PI);
        ctx.fillStyle = node.id === State.userId ? '#ffffff' : '#1e293b';
        ctx.fill();

        if(img) {
            // Avatar image
            ctx.save();
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2 - 2, 0, 2 * Math.PI);
            ctx.clip();
            ctx.drawImage(img, 0, 0, size, size);
            ctx.restore();
        } else {
            // Text fallback
            ctx.fillStyle = 'white';
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.name.charAt(0).toUpperCase(), size/2, size/2);
        }

        // Notification Badge (Red dot)
        if (node.hasUnread) {
            ctx.beginPath();
            ctx.arc(size - 10, 10, 8, 0, 2 * Math.PI);
            ctx.fillStyle = '#ef4444';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Border ring
        ctx.beginPath();
        ctx.arc(size/2, size/2, size/2 - 2, 0, 2 * Math.PI);
        ctx.lineWidth = 4;
        ctx.strokeStyle = node.id === State.userId ? '#6366f1' : '#475569';
        ctx.stroke();
    };

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(16, 16, 1);

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = node.avatar;
    // Trigger update when image loads
    img.onload = () => { draw(img); texture.needsUpdate = true; };
    img.onerror = () => { draw(null); texture.needsUpdate = true; };

    // Save draw function to update it later
    node.draw = draw;
    node.texture = texture;
    node.img = img;

    return sprite;
}

/**
 * Custom Link Label Renderer
 */
function linkRenderer(link) {
    const style = CONFIG.relStyles[link.type];
    const sprite = new SpriteText(style ? style.label : link.type);
    sprite.color = style ? style.color : 'lightgrey';
    sprite.textHeight = 3;
    sprite.backgroundColor = 'rgba(0,0,0,0.5)';
    sprite.padding = 2;
    return sprite;
}

/**
 * Data Fetching Loop
 */
async function fetchData() {
    try {
        const res = await fetch('api/data.php');
        if (!res.ok) return; // Skip if error
        const data = await res.json();

        updateRequestsUI(data.requests);

        // --- Notification Logic ---
        // Iterate through nodes and check for new messages
        let hasNewData = false;
        data.nodes.forEach(n => {
            const lastMsgId = n.last_msg_id || 0;
            const key = 'read_msg_id_' + n.id;
            const readId = parseInt(localStorage.getItem(key) || '0');

            // If server has newer message > local read id, mark as unread
            // But if I am looking at the chat right now?
            // If chat is open, we assume we read it?
            // Better: update readId when we OPEN chat or RECEIVE message in open chat.

            n.hasUnread = (lastMsgId > readId);
        });

        // Check for updates to minimize graph re-renders
        // We now also check 'hasUnread' status for re-rendering node textures
        const currentNodesSimple = State.graphData.nodes.map(n => ({
            id: n.id, name: n.name, avatar: n.avatar, signature: n.signature, val: n.val, hasUnread: n.hasUnread
        }));
        const currentLinksSimple = State.graphData.links.map(l => ({
            source: (typeof l.source === 'object' ? l.source.id : l.source),
            target: (typeof l.target === 'object' ? l.target.id : l.target),
            type: l.type
        }));

        const newNodesSimple = data.nodes.map(n => ({
            id: n.id, name: n.name, avatar: n.avatar, signature: n.signature, val: n.val, hasUnread: n.hasUnread
        }));

        if (State.isFirstLoad ||
            JSON.stringify(currentNodesSimple) !== JSON.stringify(newNodesSimple) ||
            JSON.stringify(currentLinksSimple) !== JSON.stringify(data.links)) {

            // Preserve positions if not first load
            if (!State.isFirstLoad) {
                const oldPosMap = new Map();
                State.graphData.nodes.forEach(n => {
                    if (n.x !== undefined) oldPosMap.set(n.id, {x:n.x, y:n.y, z:n.z, vx:n.vx, vy:n.vy, vz:n.vz});
                });
                data.nodes.forEach(n => {
                    const old = oldPosMap.get(n.id);
                    if (old) Object.assign(n, old);
                });
            }

            // Update graph data
            State.graphData = { nodes: data.nodes, links: data.links };
            Graph.graphData(State.graphData);

            // Re-draw textures for unread status
            if(!State.isFirstLoad) {
                 // Force update all nodes because ForceGraph might re-use objects but we need to redraw canvas
                 // Actually, nodeRenderer is called for new objects. For existing ones, we need to update texture.
                 // This library is a bit tricky with updates.
                 // We can traverse the scene to find sprites?
                 // Or easier: we updated the 'nodes' array which ForceGraph uses.
                 // But we need to tell ThreeJS to update textures.
                 // A simple way is to rely on ForceGraph's update cycle.
            }

            // UI Initial Setup
            if(State.isFirstLoad) {
                const me = data.nodes.find(n => n.id === State.userId);
                if(me) document.getElementById('my-avatar').src = me.avatar;

                const loader = document.getElementById('loader');
                if(loader) {
                    loader.style.opacity = '0';
                    setTimeout(() => loader.style.display = 'none', 500);
                }
                State.isFirstLoad = false;
            }

            document.getElementById('node-count-display').innerText = `${data.nodes.length} Nodes`;
        }
    } catch (e) {
        console.error("Polling error:", e);
    }
}

/**
 * Interaction Handlers
 */
function handleNodeClick(node) {
    const dist = 150;
    const v = new THREE.Vector3(node.x, node.y, node.z || 0);
    // If node is at exactly 0,0,0 (new node), give it a slight offset for camera calculation
    if (v.lengthSq() === 0) v.set(0, 0, 1);

    const camPos = v.clone().normalize().multiplyScalar(dist).add(v);
    camPos.y += 40;

    Graph.cameraPosition(
        { x: camPos.x, y: camPos.y, z: camPos.z },
        node,
        1500
    );

    State.highlightNodes.clear();
    State.highlightLinks.clear();
    State.highlightLink = null;
    State.highlightNodes.add(node);

    // Highlight connected neighbors
    Graph.graphData().links.forEach(link => {
        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;

        if (sId === node.id || tId === node.id) {
            State.highlightLinks.add(link);
            State.highlightNodes.add(sId === node.id ? link.target : link.source);
        }
    });

    Graph.nodeColor(Graph.nodeColor()); // Trigger update
    Graph.linkColor(Graph.linkColor());

    showNodeInspector(node);
}

function handleLinkClick(link) {
    State.highlightLinks.clear();
    State.highlightNodes.clear();

    State.highlightLinks.add(link);
    State.highlightLink = link;
    State.highlightNodes.add(link.source);
    State.highlightNodes.add(link.target);

    Graph.linkColor(Graph.linkColor());
    Graph.nodeColor(Graph.nodeColor());

    showLinkInspector(link);
}

function resetFocus() {
    State.highlightNodes.clear();
    State.highlightLinks.clear();
    State.highlightLink = null;

    Graph.cameraPosition({ x: 0, y: 0, z: 800 }, { x: 0, y: 0, z: 0 }, 1500);

    Graph.nodeColor(Graph.nodeColor());
    Graph.linkColor(Graph.linkColor());

    document.getElementById('inspector-panel').style.display = 'none';
}

/**
 * UI Generators (Inspectors)
 */
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

    // Logic to determine what buttons to show
    if(node.id !== State.userId) {
        const myRel = links.find(l => {
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            return (sId === node.id && tId === State.userId) ||
                   (tId === node.id && sId === State.userId);
        });
        const safeName = encodeURIComponent(node.name);

        if(myRel) {
            const style = CONFIG.relStyles[myRel.type] || { color: '#fff' };
            actionHtml = `
                <div style="margin-top:10px; padding:8px; background:rgba(255,255,255,0.1); border-radius:4px; text-align:center;">
                    Status: <strong style="color:${style.color}">${myRel.type}</strong>
                </div>
                <button class="action-btn" onclick="window.openChat(${node.id}, '${safeName}')">💬 Message</button>
                <button class="action-btn" style="background:#ef4444; margin-top:8px;" onclick="window.removeRel(${node.id})">💔 Remove</button>
            `;
        } else {
            // Even if no relationship, if there is history, allow viewing chat (but maybe not sending)
            // We can check if last_msg_id > 0
            if (node.last_msg_id > 0) {
                 actionHtml += `
                    <button class="action-btn" style="background:#64748b; margin-bottom:8px;" onclick="window.openChat(${node.id}, '${safeName}')">📜 History</button>
                `;
            }

            actionHtml += `
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
        <div class="inspector-title" style="text-align:center; font-weight:bold; font-size:1.2em;">${escapeHtml(node.name)}</div>
        <div class="inspector-subtitle" style="text-align:center; color:#94a3b8; font-size:0.9em;">User ID: ${node.id}</div>
        <div class="inspector-content" style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-top:10px; color:#cbd5e1; font-style:italic;">
            "${escapeHtml(node.signature)}"
        </div>
        <div class="stat-grid" style="display:grid; grid-template-columns:1fr; gap:8px; margin-top:16px; text-align:center;">
            <div class="stat-box" style="background:rgba(255,255,255,0.05); padding:8px; border-radius:6px;">
                <div class="stat-val" style="font-weight:bold; font-size:1.2em;">${relationsCount}</div>
                <div class="stat-label" style="font-size:0.8em; color:#94a3b8;">Connections</div>
            </div>
        </div>
        ${actionHtml}
    `;
}

function showLinkInspector(link) {
    const panel = document.getElementById('inspector-panel');
    const dataDiv = document.getElementById('inspector-data');
    panel.style.display = 'block';

    const style = CONFIG.relStyles[link.type];

    dataDiv.innerHTML = `
        <div class="inspector-title" style="color:${style.color}; text-align:center; font-weight:bold; font-size:1.2em;">${style.label}</div>
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

function updateRequestsUI(requests) {
    const container = document.getElementById('notif-hud');
    const list = document.getElementById('req-list');

    // Simple hashing to avoid DOM redraws if data hasn't changed
    const reqHash = JSON.stringify(requests);
    if(reqHash === State.reqHash) return;
    State.reqHash = reqHash;

    if(!requests || requests.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    list.innerHTML = requests.map(r => `
        <div class="req-item" style="background:rgba(255,255,255,0.05); padding:8px; margin-bottom:8px; border-radius:6px; font-size:0.9em;">
            <strong>${escapeHtml(r.username)}</strong> &rarr; ${r.type}
            <div class="btn-group" style="margin-top:6px; display:flex; gap:8px;">
                <button class="btn btn-accept" style="background:#10b981; color:white; border:none; padding:4px 12px; border-radius:4px; cursor:pointer;" onclick="window.acceptReq(${r.id})">Accept</button>
                <button class="btn btn-reject" style="background:#ef4444; color:white; border:none; padding:4px 12px; border-radius:4px; cursor:pointer;" onclick="window.rejectReq(${r.id})">Deny</button>
            </div>
        </div>
    `).join('');
}

/**
 * Utility: Starfield Background
 */
function initStarfield() {
    setTimeout(() => {
        if(!Graph) return;
        const scene = Graph.scene();
        const starsGeo = new THREE.BufferGeometry();
        const starCount = 3000;
        const posArray = new Float32Array(starCount * 3);
        for(let i=0; i<starCount*3; i++) {
            posArray[i] = (Math.random() - 0.5) * 5000;
        }
        starsGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const starsMat = new THREE.PointsMaterial({size: 2, color: 0xffffff, transparent: true, opacity: 0.5 });
        const starField = new THREE.Points(starsGeo, starsMat);
        scene.add(starField);
    }, 1000);
}

function escapeHtml(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function postData(url, data) {
    const fd = new FormData();
    for(let k in data) fd.append(k, data[k]);

    // Add CSRF Token
    const meta = document.querySelector('meta[name="csrf-token"]');
    if(meta) fd.append('csrf_token', meta.content);

    return fetch(url, { method: 'POST', body: fd });
}

// --- Global Window Functions (Exposed for HTML Event Handlers) ---

window.sendRequest = function(toId) {
    const type = document.getElementById('req-type').value;
    postData('api/relations.php', { action: 'request', to_id: toId, type: type })
        .then(res => res.json())
        .then(res => {
            if(res.success) {
                alert('Request Sent!');
                fetchData();
            } else {
                alert(res.error || 'Failed to send request');
            }
        });
};

window.acceptReq = function(reqId) {
    postData('api/relations.php', { action: 'accept_request', request_id: reqId }).then(fetchData);
};

window.rejectReq = function(reqId) {
    postData('api/relations.php', { action: 'reject_request', request_id: reqId }).then(fetchData);
};

window.removeRel = function(toId) {
    if(!confirm("Are you sure you want to remove this relationship?")) return;
    postData('api/relations.php', { action: 'remove', to_id: toId }).then(fetchData);
};

window.openChat = function(userId, encodedName) {
    const userName = decodeURIComponent(encodedName);
    const chatHud = document.getElementById('chat-hud');
    // Allow pointer events on HUD when chat is open
    chatHud.style.pointerEvents = 'auto';

    // Mark as read immediately when opening chat
    // Find the node to get the last_msg_id
    const node = State.graphData.nodes.find(n => n.id === userId);
    if(node) {
        localStorage.setItem('read_msg_id_' + userId, node.last_msg_id);
        node.hasUnread = false; // Optimistic update
        if(node.draw) {
             node.draw(node.img);
             node.texture.needsUpdate = true;
        }
    }

    if(document.getElementById(`chat-${userId}`)) return;

    const div = document.createElement('div');
    div.id = `chat-${userId}`;
    div.className = 'chat-window';
    div.innerHTML = `
        <div class="chat-header">
            <span>${escapeHtml(userName)}</span>
            <span style="cursor:pointer; color:#ef4444;" onclick="window.closeChat(${userId})">✕</span>
        </div>
        <div class="chat-msgs" id="msgs-${userId}">Loading...</div>
        <form class="chat-input-area" onsubmit="window.sendMsg(event, ${userId})">
            <input type="text" style="flex:1; background:none; border:none; color:white; outline:none;" placeholder="Message..." required>
            <button style="background:none; border:none; color:#6366f1; cursor:pointer;">Send</button>
        </form>
    `;
    chatHud.appendChild(div);

    // Load immediately
    window.loadMsgs(userId);

    // Start polling for this chat
    if(State.chatIntervals[userId]) clearInterval(State.chatIntervals[userId]);
    State.chatIntervals[userId] = setInterval(() => {
        if(!document.getElementById(`chat-${userId}`)) {
            window.closeChat(userId);
        } else {
            window.loadMsgs(userId);
        }
    }, 3000);
};

window.closeChat = function(userId) {
    const win = document.getElementById(`chat-${userId}`);
    if(win) win.remove();
    if(State.chatIntervals[userId]) {
        clearInterval(State.chatIntervals[userId]);
        delete State.chatIntervals[userId];
    }

    // If no chats open, disable pointer events on HUD container
    if(document.getElementById('chat-hud').children.length === 0) {
        document.getElementById('chat-hud').style.pointerEvents = 'none';
    }
};

window.loadMsgs = function(userId) {
    const container = document.getElementById(`msgs-${userId}`);
    if(!container) return;

    fetch(`api/messages.php?action=retrieve&to_id=${userId}`)
    .then(r => r.json())
    .then(data => {
        if(data.error) return;

        // Update Read Status
        const maxId = data.reduce((max, m) => Math.max(max, m.id), 0);
        if(maxId > 0) {
             localStorage.setItem('read_msg_id_' + userId, maxId);
        }

        // Optimization: check if content length changed before rewriting innerHTML
        // For simplicity here we just rewrite
        const html = data.map(m => `
            <div style="text-align:${m.from_id == State.userId ? 'right' : 'left'}; margin-bottom:4px;">
                <span style="background:${m.from_id == State.userId ? '#6366f1' : '#334155'}; padding:4px 8px; border-radius:4px; display:inline-block; max-width:80%; word-break:break-word;">
                    ${escapeHtml(m.message)}
                </span>
            </div>
        `).join('');

        if(container.innerHTML !== html) {
            container.innerHTML = html;
            container.scrollTop = container.scrollHeight;
        }
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

    fetch('api/messages.php', { method:'POST', body:fd })
    .then(r => r.json())
    .then(res => {
        if(res.success) {
            input.value = '';
            window.loadMsgs(userId);
        } else {
            alert(res.error || 'Failed to send');
        }
    });
};
