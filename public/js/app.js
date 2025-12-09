/**
 * Gossip Chain 3D - Main Application Logic
 * refactored for gspc2
 */

// --- Configuration ---
// Use config injected from backend if available, else fallback
const CONFIG = {
    pollInterval: 3000,
    relStyles: window.APP_CONFIG && window.APP_CONFIG.RELATION_STYLES ? window.APP_CONFIG.RELATION_STYLES : {
        'DATING': { color: '#ec4899', particle: true, label: '❤️ Dating' },
        'BEST_FRIEND': { color: '#3b82f6', particle: false, label: '💎 Bestie' },
        'BROTHER': { color: '#10b981', particle: false, label: '👊 Bro' },
        'SISTER': { color: '#10b981', particle: false, label: '🌸 Sis' },
        'BEEFING': { color: '#ef4444', particle: true, label: '💀 Beefing' },
        'CRUSH': { color: '#a855f7', particle: true, label: '✨ Crush' }
    }
};

const RELATION_TYPES = window.APP_CONFIG && window.APP_CONFIG.RELATION_TYPES ? window.APP_CONFIG.RELATION_TYPES : ['DATING', 'BEST_FRIEND', 'BROTHER', 'SISTER', 'BEEFING', 'CRUSH'];

// --- Global State ---
const State = {
    userId: null,
    graphData: { nodes: [], links: [] },
    reqHash: "",
    highlightNodes: new Set(),
    highlightLinks: new Set(),
    highlightLink: null,
    isFirstLoad: true,
    etag: null, // Store ETag for caching
    activeChats: new Set() // Track active chat userIds
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
    document.getElementById('search-input').addEventListener('input', handleSearch);

    // Initialize Signature Update Listener
    document.getElementById('signature-update-btn').addEventListener('click', updateSignature);
    const sigInput = document.getElementById('signature-input');
    if (sigInput) {
        sigInput.addEventListener('input', (e) => {
            const len = e.target.value.length;
            document.getElementById('signature-counter').innerText = `${len} / 160`;
        });
    }

    // Start Loops
    syncReadReceipts().then(() => {
        fetchData();
        setInterval(fetchData, CONFIG.pollInterval);
    });
    initStarfield();
}

/**
 * Hydrate Local Storage with Read Receipts from Server
 */
async function syncReadReceipts() {
    try {
        const res = await fetch('api/messages.php?action=sync_read_receipts');
        const data = await res.json();
        if (data.success && data.receipts) {
            data.receipts.forEach(r => {
                const key = `read_msg_id_${State.userId}_${r.peer_id}`;
                // Only overwrite if server has a higher value (or if local is missing)
                const localVal = parseInt(localStorage.getItem(key) || '0');
                if (r.last_read_msg_id > localVal) {
                    localStorage.setItem(key, r.last_read_msg_id);
                }
            });
        }
    } catch (e) {
        console.error("Hydration failed:", e);
    }
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

        // Border ring
        ctx.beginPath();
        ctx.arc(size/2, size/2, size/2 - 2, 0, 2 * Math.PI);
        ctx.lineWidth = 4;
        ctx.strokeStyle = node.id === State.userId ? '#6366f1' : '#475569';
        ctx.stroke();
    };

    // Clean up previous texture if it exists to prevent memory leak
    if (node.texture) {
        node.texture.dispose();
    }

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
    // We add a dispose method to node to clean up manually if needed
    node.dispose = () => {
        if(node.texture) node.texture.dispose();
        if(node.material) node.material.dispose();
    };

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
        const headers = {};
        if (State.etag) {
            headers['If-None-Match'] = State.etag;
        }

        const res = await fetch('api/data.php', { headers });

        // Handle 304 Not Modified
        if (res.status === 304) {
            return;
        }

        if (!res.ok) return;

        // Update ETag
        const etag = res.headers.get('ETag');
        if (etag) State.etag = etag;

        const data = await res.json();

        updateRequestsUI(data.requests);
        updateUnreadMessagesUI(data.nodes);

        // --- Notification & Chat Logic ---
        data.nodes.forEach(n => {
            if (n.id === State.userId) return;

            const lastMsgId = n.last_msg_id || 0;
            // Scoped key for localStorage
            const key = `read_msg_id_${State.userId}_${n.id}`;
            const readId = parseInt(localStorage.getItem(key) || '0');

            // If we have an active chat open for this user, trigger a load
            if (State.activeChats.has(n.id)) {
                const chatWin = document.getElementById(`chat-${n.id}`);
                if (chatWin) {
                    const currentMax = parseInt(chatWin.getAttribute('data-last-id') || '0');
                    if (lastMsgId > currentMax) {
                        window.loadMsgs(n.id);
                    }
                }
            }

            // Check for new incoming messages for toast
            if (lastMsgId > readId) {
                // Scoped session storage key as well
                const toastKey = `last_toasted_msg_${State.userId}_${n.id}`;
                const lastToastedId = parseInt(sessionStorage.getItem(toastKey) || '0');
                if (lastMsgId > lastToastedId) {
                    // Only toast if not currently chatting with them
                    if (!State.activeChats.has(n.id)) {
                        // Pass onClick handler to open chat
                        showToast(
                            `New message from ${n.name}`,
                            'info',
                            0, // 0 = persistent until clicked or dismissed
                            () => window.openChat(n.id, encodeURIComponent(n.name)),
                            { userId: n.id }
                        );
                    }
                    sessionStorage.setItem(toastKey, lastMsgId);
                }
            }

            n.hasUnread = (lastMsgId > readId);
        });

        // Check for updates to minimize graph re-renders
        const currentNodesSimple = State.graphData.nodes.map(n => ({
            id: n.id, name: n.name, avatar: n.avatar, signature: n.signature, val: n.val, hasUnread: n.hasUnread
        }));

        const newNodesSimple = data.nodes.map(n => ({
            id: n.id, name: n.name, avatar: n.avatar, signature: n.signature, val: n.val, hasUnread: n.hasUnread
        }));

        const currentLinksSimple = State.graphData.links.map(l => ({
            source: (typeof l.source === 'object' ? l.source.id : l.source),
            target: (typeof l.target === 'object' ? l.target.id : l.target),
            type: l.type
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

            // UI Initial Setup
            // Update own profile info
            const me = data.nodes.find(n => n.id === State.userId);
            if (me) {
                if (State.isFirstLoad) document.getElementById('my-avatar').src = me.avatar;

                const sigEl = document.getElementById('my-signature');
                if (sigEl) sigEl.textContent = me.signature || "No signature set.";
            }

            if(State.isFirstLoad) {
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

    Graph.graphData().links.forEach(link => {
        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;

        if (sId === node.id || tId === node.id) {
            State.highlightLinks.add(link);
            State.highlightNodes.add(sId === node.id ? link.target : link.source);
        }
    });

    Graph.nodeColor(Graph.nodeColor());
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
            // Generate options for updating, marking the current one as selected
            const options = RELATION_TYPES.map(t =>
                `<option value="${t}" ${myRel.type === t ? 'selected' : ''}>${t}</option>`
            ).join('');

            actionHtml = `
                <div style="margin-top:10px; padding:8px; background:rgba(255,255,255,0.1); border-radius:4px; text-align:center;">
                    Status: <strong style="color:${style.color}">${myRel.type}</strong>
                </div>

                <div style="margin-top:8px;">
                     <select id="update-rel-type" style="width:70%; padding:6px; background:#1e293b; color:white; border:1px solid #475569; border-radius:4px;">
                        ${options}
                    </select>
                    <button class="action-btn" style="width:25%; display:inline-block;" onclick="window.updateRel(${node.id})">Update</button>
                </div>

                <button class="action-btn" onclick="window.openChat(${node.id}, '${safeName}')">💬 Message</button>
                <button class="action-btn" style="background:#ef4444; margin-top:8px;" onclick="window.removeRel(${node.id})">💔 Remove</button>
            `;
        } else {
            if (node.last_msg_id > 0) {
                 actionHtml += `
                    <button class="action-btn" style="background:#64748b; margin-bottom:8px;" onclick="window.openChat(${node.id}, '${safeName}')">📜 History</button>
                `;
            }

            const options = RELATION_TYPES.map(t => `<option value="${t}">Request ${t}</option>`).join('');
            actionHtml += `
                <select id="req-type" style="width:100%; padding:8px; margin-top:10px; background:#1e293b; color:white; border:1px solid #475569; border-radius:4px;">
                    ${options}
                </select>
                <button class="action-btn" onclick="window.sendRequest(${node.id})">🚀 Send Request</button>
            `;
        }
    }

    dataDiv.innerHTML = `
        <img src="${node.avatar}" style="width:80px; height:80px; border-radius:50%; margin:0 auto 10px; display:block; border:3px solid #6366f1;">
        <div class="inspector-title" style="text-align:center; font-weight:bold; font-size:1.2em;">${escapeHtml(node.name)}</div>
        <div class="inspector-subtitle" style="text-align:center; color:#94a3b8; font-size:0.9em;">User ID: ${node.id}</div>
        <div class="inspector-content signature-display" style="background:rgba(0,0,0,0.3); padding:10px; border-radius:8px; margin-top:10px; color:#cbd5e1; font-style:italic; text-align: center;">${escapeHtml(node.signature)}</div>
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

function updateHudVisibility() {
    const hud = document.getElementById('notif-hud');
    const toastList = document.getElementById('toast-list');
    const reqList = document.getElementById('requests-container');
    const unreadList = document.getElementById('unread-msgs-container');

    const hasToasts = toastList.children.length > 0;
    const hasReqs = reqList.style.display !== 'none';
    const hasUnreads = unreadList.style.display !== 'none';

    if (hasToasts || hasReqs || hasUnreads) {
        hud.style.display = 'block';
    } else {
        hud.style.display = 'none';
    }
}

function updateRequestsUI(requests) {
    const container = document.getElementById('requests-container');
    const list = document.getElementById('req-list');

    const reqHash = JSON.stringify(requests);
    if(reqHash === State.reqHash) return;
    State.reqHash = reqHash;

    if(!requests || requests.length === 0) {
        container.style.display = 'none';
        updateHudVisibility();
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
    updateHudVisibility();
}

function updateUnreadMessagesUI(nodes) {
    const container = document.getElementById('unread-msgs-container');
    const list = document.getElementById('unread-msgs-list');
    const unreadNodes = nodes.filter(n => n.hasUnread && n.id !== State.userId);

    if (unreadNodes.length === 0) {
        container.style.display = 'none';
        updateHudVisibility();
        return;
    }

    container.style.display = 'block';
    list.innerHTML = unreadNodes.map(n => `
        <div class="unread-item toast info show" onclick="window.openChat(${n.id}, '${encodeURIComponent(n.name)}')" style="cursor:pointer; position: relative; transform: none; margin-bottom: 8px;">
            New message from <strong>${escapeHtml(n.name)}</strong>
        </div>
    `).join('');
    updateHudVisibility();
}

function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    const resultsContainer = document.getElementById('search-results');
    if (!searchTerm) {
        resultsContainer.innerHTML = '';
        resultsContainer.style.display = 'none';
        return;
    }

    const hits = State.graphData.nodes.filter(n =>
        n.name.toLowerCase().includes(searchTerm) || String(n.id) === searchTerm
    );

    if (hits.length === 0) {
        resultsContainer.innerHTML = '<div class="search-result-item">No users found.</div>';
    } else {
        resultsContainer.innerHTML = hits.map(n => `
            <div class="search-result-item" onclick="handleNodeClick(State.graphData.nodes.find(user => user.id === ${n.id})); document.getElementById('search-input').value=''; handleSearch({target:{value:''}});">
                ${escapeHtml(n.name)}
            </div>
        `).join('');
    }
    resultsContainer.style.display = 'block';
}

function updateSignature() {
    const newSignature = document.getElementById('signature-input').value;
    if (!newSignature) {
        showToast("Signature cannot be empty.", "error");
        return;
    }

    postData('api/profile.php', { signature: newSignature })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast("Signature updated!");
                document.getElementById('signature-input').value = '';
                fetchData();
            } else {
                showToast("Error: " + data.error, "error");
            }
        });
}

/**
 * Shows a toast notification.
 * @param {string} message
 * @param {string} type
 * @param {number} duration
 * @param {Function|null} onClick - Optional callback when toast is clicked
 * @param {Object} dataAttrs - Optional data attributes
 */
function showToast(message, type = 'success', duration = 3000, onClick = null, dataAttrs = {}) {
    const container = document.getElementById('toast-list');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    // Style adjustments for being in the list
    toast.style.position = 'relative';
    toast.style.transform = 'none';
    toast.style.marginBottom = '8px';

    // Apply data attributes
    for (const [key, value] of Object.entries(dataAttrs)) {
        toast.dataset[key] = value;
    }

    toast.onclick = () => {
        if (onClick) onClick();

        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentElement) container.removeChild(toast);
            updateHudVisibility();
        }, 300);
    };

    container.appendChild(toast);
    updateHudVisibility();

    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.remove('show');
                setTimeout(() => {
                    if (toast.parentElement) container.removeChild(toast);
                    updateHudVisibility();
                }, 300);
            }
        }, duration);
    }
}

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
                showToast('Request Sent!');
                fetchData();
            } else {
                showToast(res.error || 'Failed to send request', 'error');
            }
        });
};

window.updateRel = function(toId) {
    const type = document.getElementById('update-rel-type').value;
    postData('api/relations.php', { action: 'update', to_id: toId, type: type })
        .then(res => res.json())
        .then(res => {
            if(res.success) {
                showToast('Relationship updated!');
                fetchData();
            } else {
                showToast(res.error || 'Failed to update', 'error');
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
    chatHud.style.pointerEvents = 'auto';

    State.activeChats.add(userId);

    const node = State.graphData.nodes.find(n => n.id === userId);
    if(node) {
        // Update local storage
        const lastId = node.last_msg_id;
        localStorage.setItem(`read_msg_id_${State.userId}_${userId}`, lastId);

        // Lazy Sync: Update Server
        if (lastId > 0) {
            postData('api/messages.php', {
                action: 'mark_read',
                peer_id: userId,
                last_read_msg_id: lastId
            });
        }

        node.hasUnread = false;
        if(node.draw) {
             node.draw(node.img);
             node.texture.needsUpdate = true;
        }
        // Force update of unread UI
        updateUnreadMessagesUI(State.graphData.nodes);
    }

    // Clear relevant toasts
    const toasts = document.querySelectorAll(`.toast[data-user-id="${userId}"]`);
    toasts.forEach(t => {
        t.classList.remove('show');
        setTimeout(() => {
            if (t.parentElement) t.parentElement.removeChild(t);
            updateHudVisibility();
        }, 300);
    });

    if(document.getElementById(`chat-${userId}`)) return;

    const div = document.createElement('div');
    div.id = `chat-${userId}`;
    div.className = 'chat-window';
    div.setAttribute('data-last-id', '0'); // Init last id
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

    // Initial load
    window.loadMsgs(userId);

    // Add scroll listener for pagination
    const msgsContainer = document.getElementById(`msgs-${userId}`);
    msgsContainer.addEventListener('scroll', () => {
        if(msgsContainer.scrollTop === 0) {
            // Load more
            // Get oldest ID from the first child
            const firstMsg = msgsContainer.firstElementChild;
            if (firstMsg) {
                const oldestId = parseInt(firstMsg.getAttribute('data-id'));
                if (oldestId > 1) { // 1 is theoretical min
                    window.loadMsgs(userId, oldestId);
                }
            }
        }
    });
};

window.closeChat = function(userId) {
    const win = document.getElementById(`chat-${userId}`);
    if(win) win.remove();
    State.activeChats.delete(userId);

    if(document.getElementById('chat-hud').children.length === 0) {
        document.getElementById('chat-hud').style.pointerEvents = 'none';
    }
};

window.loadMsgs = function(userId, beforeId = 0) {
    const container = document.getElementById(`msgs-${userId}`);
    if(!container) return;

    // Logic for loading more (prepend) or loading latest (append/replace)
    const isPagination = beforeId > 0;

    const url = `api/messages.php?action=retrieve&to_id=${userId}` + (isPagination ? `&before_id=${beforeId}` : '');

    fetch(url)
    .then(r => r.json())
    .then(data => {
        if(data.error) return;

        if (data.length === 0 && isPagination) {
             // No more older messages
             return;
        }

        // Generate HTML
        const html = data.map(m => `
            <div class="msg-row" data-id="${m.id}" style="text-align:${m.from_id == State.userId ? 'right' : 'left'}; margin-bottom:4px;">
                <span style="background:${m.from_id == State.userId ? '#6366f1' : '#334155'}; padding:4px 8px; border-radius:4px; display:inline-block; max-width:80%; word-break:break-word;">
                    ${escapeHtml(m.message)}
                </span>
            </div>
        `).join('');

        if (isPagination) {
            // Save scroll height before appending
            const oldHeight = container.scrollHeight;
            const oldTop = container.scrollTop;

            // Prepend content
            container.insertAdjacentHTML('afterbegin', html);

            // Adjust scroll position to keep view stable
            // New scroll top = new height - old height + old top (which was 0 usually)
            container.scrollTop = container.scrollHeight - oldHeight;

        } else {
            // Initial Load or Update
            if (container.innerHTML === 'Loading...') {
                container.innerHTML = html;
                container.scrollTop = container.scrollHeight;
            } else {
                // Determine the last ID we currently have
                const lastChild = container.lastElementChild;
                const currentMaxId = lastChild ? parseInt(lastChild.getAttribute('data-id')) : 0;

                // Filter data for new messages
                const newMsgs = data.filter(m => m.id > currentMaxId);

                if (newMsgs.length > 0) {
                     const newHtml = newMsgs.map(m => `
                        <div class="msg-row" data-id="${m.id}" style="text-align:${m.from_id == State.userId ? 'right' : 'left'}; margin-bottom:4px;">
                            <span style="background:${m.from_id == State.userId ? '#6366f1' : '#334155'}; padding:4px 8px; border-radius:4px; display:inline-block; max-width:80%; word-break:break-word;">
                                ${escapeHtml(m.message)}
                            </span>
                        </div>
                    `).join('');
                    container.insertAdjacentHTML('beforeend', newHtml);

                    // Auto scroll to bottom only if user was near bottom
                    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
                    if (isNearBottom) {
                        container.scrollTop = container.scrollHeight;
                    } else {
                        showToast('New message received (Scroll down)', 'info');
                    }
                }
            }
        }

        // Update Read Status tracking
        if (data.length > 0) {
            const newest = data[data.length - 1];
            if (!isPagination) {
                const newMax = newest.id;
                // Update window attribute
                document.getElementById(`chat-${userId}`).setAttribute('data-last-id', newMax);
                // Scoped storage key
                localStorage.setItem(`read_msg_id_${State.userId}_${userId}`, newMax);

                // Lazy Sync: Update Server (since we just read new messages)
                postData('api/messages.php', {
                    action: 'mark_read',
                    peer_id: userId,
                    last_read_msg_id: newMax
                });
            }
        }
    });
};

window.sendMsg = function(e, userId) {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const msg = input.value;
    if(!msg) return;

    postData('api/messages.php', {
        action: 'send',
        to_id: userId,
        message: msg
    })
    .then(r => r.json())
    .then(res => {
        if(res.success) {
            input.value = '';
            // Reload latest messages
            window.loadMsgs(userId);
        } else {
            showToast(res.error || 'Failed to send', 'error');
        }
    });
};
