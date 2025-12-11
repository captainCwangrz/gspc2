import { fetchGraphData, syncReadReceipts } from './api.js';
import { createGraph, animateGraph, initStarfieldBackground } from './graph.js';
import { initUI, updateRequestsUI, updateUnreadMessagesUI, showToast, escapeHtml } from './ui.js';

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

export const State = {
    userId: null,
    graphData: { nodes: [], links: [] },
    reqHash: "",
    highlightNodes: new Set(),
    highlightLinks: new Set(),
    highlightLink: null,
    isFirstLoad: true,
    etag: null,
    activeChats: new Set(),
    lastUpdate: null
};

let Graph = null;
let pollTimer = null;

export function initApp(userId) {
    State.userId = userId;
    const elem = document.getElementById('3d-graph');

    Graph = createGraph({
        state: State,
        config: CONFIG,
        element: elem,
        onNodeClick: handleNodeClick,
        onLinkClick: handleLinkClick,
        onBackgroundClick: resetFocus
    });

    window.handleNodeClick = handleNodeClick;

    initUI({ state: State, config: CONFIG, relationTypes: RELATION_TYPES, refreshData: loadGraphData });

    hydrateReadReceipts();
    loadGraphData();

    initStarfieldBackground();
    animateGraph();
}

async function hydrateReadReceipts() {
    const data = await syncReadReceipts();
    if (data.success && data.receipts) {
        data.receipts.forEach(r => {
            const key = `read_msg_id_${State.userId}_${r.peer_id}`;
            const localVal = parseInt(localStorage.getItem(key) || '0');
            if (r.last_read_msg_id > localVal) {
                localStorage.setItem(key, r.last_read_msg_id);
            }
        });
    }
}

async function loadGraphData() {
    try {
        const response = await fetchGraphData({ etag: State.etag, lastUpdate: State.lastUpdate });
        if (response.status === 304 || !response.data) {
            scheduleNextPoll();
            return;
        }

        if (response.etag) State.etag = response.etag;
        applyGraphPayload(response.data);
    } catch (e) {
        console.error('Polling error:', e);
    } finally {
        scheduleNextPoll();
    }
}

function scheduleNextPoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(loadGraphData, CONFIG.pollInterval);
}

function applyGraphPayload(data) {
    const incomingNodes = data.nodes || [];
    const incomingLinks = data.links || [];

    mergeGraphData(incomingNodes, incomingLinks, data.incremental);
    applyLastMessages(data.last_messages || {});

    updateRequestsUI(data.requests || []);
    updateUnreadMessagesUI(State.graphData.nodes);

    Graph.graphData(State.graphData);

    const me = State.graphData.nodes.find(n => n.id === State.userId);
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

    const nodeDisplay = document.getElementById('node-count-display');
    if (nodeDisplay) nodeDisplay.innerText = `${State.graphData.nodes.length} Nodes`;

    State.lastUpdate = data.last_update || State.lastUpdate;
}

function mergeGraphData(nodes, links, incremental = false) {
    const existingPositions = new Map();
    State.graphData.nodes.forEach(n => {
        if (n.x !== undefined) {
            existingPositions.set(n.id, {
                x:n.x, y:n.y, z:n.z,
                vx:n.vx, vy:n.vy, vz:n.vz,
                fx: n.fx, fy: n.fy, fz: n.fz
            });
        }
    });

    const nodeMap = new Map((incremental && !State.isFirstLoad) ? State.graphData.nodes.map(n => [n.id, n]) : []);
    nodes.forEach(n => {
        const previous = nodeMap.get(n.id) || {};
        const merged = { ...previous, ...n };
        const oldPos = existingPositions.get(n.id);
        if (oldPos) Object.assign(merged, oldPos);
        nodeMap.set(n.id, merged);
    });

    if (!incremental || State.isFirstLoad) {
        State.graphData.nodes = Array.from(nodeMap.values());
    } else {
        State.graphData.nodes = Array.from(nodeMap.values());
    }

    const linkKey = (l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return `${s}-${t}`;
    };

    const linkMap = new Map((incremental && !State.isFirstLoad) ? State.graphData.links.map(l => [linkKey(l), l]) : []);
    links.forEach(l => {
        const existing = linkMap.get(linkKey(l)) || {};
        linkMap.set(linkKey(l), { ...existing, ...l });
    });

    State.graphData.links = Array.from(linkMap.values());
}

function applyLastMessages(lastMessages) {
    // 遍历所有节点（注意：这里遍历的是本地的全量节点 State.graphData.nodes）
    State.graphData.nodes.forEach(node => {
        const keyName = String(node.id);
        
        // 1. 获取后端传来的最新消息 ID
        let serverLastMsgId = 0;
        if (Object.prototype.hasOwnProperty.call(lastMessages, keyName)) {
            serverLastMsgId = parseInt(lastMessages[keyName]);
        }

        // 如果没有消息变动，直接跳过（性能优化）
        if (serverLastMsgId <= (node.last_msg_id || 0)) {
            return; 
        }

        // 更新本地节点状态
        node.last_msg_id = serverLastMsgId;

        // 2. 核心逻辑：判断是“刷新聊天”还是“显示通知”
        const readKey = `read_msg_id_${State.userId}_${node.id}`;
        const localReadId = parseInt(localStorage.getItem(readKey) || '0');

        // 只有当服务器消息 ID 大于本地已读 ID 时，才算“新消息”
        if (serverLastMsgId > localReadId) {
            
            // A. 如果聊天窗口是打开的 -> 自动刷新消息
            if (State.activeChats.has(node.id)) {
                // 调用 UI 层的加载消息函数（它会自动追加新消息）
                if (window.loadMsgs) {
                    window.loadMsgs(node.id);
                }
            } 
            // B. 如果聊天窗口没打开 -> 弹 Toast 通知
            else {
                // 使用 sessionStorage 防止同一个消息 ID 重复弹窗
                const toastKey = `last_toasted_msg_${State.userId}_${node.id}`;
                const lastToastedId = parseInt(sessionStorage.getItem(toastKey) || '0');

                if (serverLastMsgId > lastToastedId) {
                    if (window.showToast) {
                        window.showToast(
                            `New message from ${node.name}`,
                            'info',
                            3000, // 3秒自动消失
                            () => window.openChat(node.id, encodeURIComponent(node.name)), // 点击打开聊天
                            { userId: node.id }
                        );
                    }
                    sessionStorage.setItem(toastKey, serverLastMsgId);
                }
                
                // 标记为未读，供 HUD 列表使用
                node.hasUnread = true;
            }
        }
    });
}

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

window.showToast = showToast;
