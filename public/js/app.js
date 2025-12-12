import { fetchGraphData, syncReadReceipts } from './api.js';
import { createGraph, animateGraph, initStarfieldBackground, disposeLinkVisual } from './graph.js';
import { initUI, updateRequestsUI, updateNotificationHUD, showToast, escapeHtml, getRelLabel } from './ui.js';

if (!window.APP_CONFIG) {
    console.error('APP_CONFIG is missing. Unable to initialize application configuration.');
}

const CONFIG = window.APP_CONFIG ? {
    pollInterval: 3000,
    relStyles: window.APP_CONFIG.RELATION_STYLES
} : null;

const RELATION_TYPES = window.APP_CONFIG ? (window.APP_CONFIG.RELATION_TYPES || []) : [];
const DIRECTED_RELATION_TYPES = window.APP_CONFIG?.DIRECTED_RELATION_TYPES || [];
const isDirected = (type) => DIRECTED_RELATION_TYPES.includes(type);

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
    lastUpdate: null,
    nodeById: new Map()
};

let Graph = null;
let pollTimer = null;

export function initApp(userId) {
    if (!CONFIG || !CONFIG.relStyles) {
        console.error('Required configuration missing. Aborting initialization.');
        return;
    }

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
    if (!CONFIG) return;
    let nextDelay = CONFIG.pollInterval;
    try {
        const response = await fetchGraphData({ etag: State.etag, lastUpdate: State.lastUpdate, wait: true });
        if (response.status === 304 || !response.data) {
            nextDelay = response.timedOut ? 0 : CONFIG.pollInterval;
            return;
        }

        if (response.etag) State.etag = response.etag;
        applyGraphPayload(response.data);
    } catch (e) {
        console.error('Polling error:', e);
    } finally {
        scheduleNextPoll(nextDelay);
    }
}

function scheduleNextPoll(delay = CONFIG ? CONFIG.pollInterval : 3000) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(loadGraphData, delay);
}

function applyGraphPayload(data) {
    const incomingNodes = data.nodes || [];
    const incomingLinks = data.links || [];

    const topologyChanged = mergeGraphData(incomingNodes, incomingLinks, data.incremental);
    applyLastMessages(data.last_messages || {});

    updateRequestsUI(data.requests || []);
    updateNotificationHUD(State.graphData.nodes);

    if (topologyChanged || State.isFirstLoad) {
        Graph.graphData(State.graphData);

        // FORCE VISUAL REFRESH
        // Re-assigning the accessor clears the cache and regenerates
        // the particle beams for the updated relationship types.
        if (Graph.linkThreeObject) {
            Graph.linkThreeObject(Graph.linkThreeObject());

            // The recreated 3D objects start at the origin. Nudge the
            // force simulation so linkPositionUpdate runs and places
            // them correctly.
            if (Graph.d3AlphaTarget) {
                Graph.d3AlphaTarget(0.1).d3Restart();
            }
        }
    }

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
    let hasTopologyChanges = false;

    const previousNodeCount = State.graphData.nodes.length;
    const previousLinkCount = State.graphData.links.length;

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

    if (!incremental && nodes.length !== previousNodeCount) {
        hasTopologyChanges = true;
    }

    nodes.forEach(n => {
        if (!nodeMap.has(n.id)) {
            hasTopologyChanges = true;
        }

        const previous = nodeMap.get(n.id) || {};
        const { last_msg_id, ...nodeProps } = n;
        const merged = { ...previous, ...nodeProps };
        const oldPos = existingPositions.get(n.id);
        if (oldPos) Object.assign(merged, oldPos);
        nodeMap.set(n.id, merged);
    });

    State.graphData.nodes = Array.from(nodeMap.values());
    State.nodeById = new Map(State.graphData.nodes.map(n => [n.id, n]));

    const linkKey = (l) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return `${s}-${t}`;
    };

    const linkMap = new Map((incremental && !State.isFirstLoad) ? State.graphData.links.map(l => [linkKey(l), l]) : []);

    if (!incremental && links.length !== previousLinkCount) {
        hasTopologyChanges = true;
    }

    links.forEach(l => {
        const key = linkKey(l);
        if (l.deleted === true) {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            const existing = linkMap.get(key);
            if (existing) {
                disposeLinkVisual(existing);
            }

            linkMap.delete(key);
            if (!isDirected(l.type)) {
                const reverseKey = `${t}-${s}`;
                const reverseExisting = linkMap.get(reverseKey);
                if (reverseExisting) {
                    disposeLinkVisual(reverseExisting);
                }
                linkMap.delete(reverseKey);
            }
            hasTopologyChanges = true;
            return;
        }
        if (!linkMap.has(key)) {
            hasTopologyChanges = true;
        }

        const existing = linkMap.get(key) || {};

        // If type changed (e.g. Request Accepted), flag as topology change
        if (existing.type !== l.type) {
            hasTopologyChanges = true;

            disposeLinkVisual(existing);
        }

        const merged = { ...existing, ...l };

        if (existing.source && typeof existing.source === 'object') {
            merged.source = existing.source;
        }
        if (existing.target && typeof existing.target === 'object') {
            merged.target = existing.target;
        }

        linkMap.set(key, merged);
    });

    const linksArray = Array.from(linkMap.values());

    const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
    const directedBuckets = new Map();

    linksArray.forEach(link => {
        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;

        if (isDirected(link.type)) {
            const key = pairKey(sId, tId);
            if (!directedBuckets.has(key)) directedBuckets.set(key, []);
            directedBuckets.get(key).push(link);
        }
    });

    directedBuckets.forEach((linksForPair) => {
        if (linksForPair.length < 2) {
            linksForPair.forEach(l => {
                l.displayLabel = `${getRelLabel(l.type)} →`;
                l.hideLabel = false;
            });
            return;
        }

        const forward = linksForPair.find(l => {
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            return sId < tId;
        });
        const backward = linksForPair.find(l => {
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            return sId > tId;
        });

        if (forward && backward && forward.type === backward.type && forward.type === 'CRUSH') {
            forward.displayLabel = `${getRelLabel(forward.type)} ↔`;
            forward.hideLabel = false;
            backward.displayLabel = `${getRelLabel(backward.type)} ↔`;
            backward.hideLabel = true;
            return;
        }

        linksForPair.forEach(l => {
            l.displayLabel = `${getRelLabel(l.type)} →`;
            l.hideLabel = false;
        });
    });

    linksArray.forEach(link => {
        if (!isDirected(link.type)) {
            link.displayLabel = getRelLabel(link.type);
            link.hideLabel = false;
        } else if (!link.displayLabel) {
            link.displayLabel = `${getRelLabel(link.type)} →`;
            link.hideLabel = false;
        }
    });

    State.graphData.links = linksArray;

    return hasTopologyChanges;
}

function applyLastMessages(lastMessages) {
    Object.keys(lastMessages).forEach(keyName => {
        const nodeId = parseInt(keyName);
        const node = State.nodeById.get(nodeId);
        if (!node) return;

        const serverLastMsgId = parseInt(lastMessages[keyName]);
        if (serverLastMsgId <= (node.last_msg_id || 0)) return;

        node.last_msg_id = serverLastMsgId;

        const readKey = `read_msg_id_${State.userId}_${node.id}`;
        const localReadId = parseInt(localStorage.getItem(readKey) || '0');

        if (serverLastMsgId > localReadId) {
            if (State.activeChats.has(node.id)) {
                if (window.loadMsgs) {
                    window.loadMsgs(node.id);
                }
            } else {
                const toastKey = `last_toasted_msg_${State.userId}_${node.id}`;
                const lastToastedId = parseInt(sessionStorage.getItem(toastKey) || '0');

                if (serverLastMsgId > lastToastedId) {
                    if (window.showToast) {
                        window.showToast(
                            `New message from ${node.name}`,
                            'info',
                            3000,
                            () => window.openChat(node.id, node.name),
                            { userId: node.id }
                        );
                    }
                    sessionStorage.setItem(toastKey, serverLastMsgId);
                }

                node.hasActiveNotification = true;
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
    let statusHtml = '';

    if(node.id !== State.userId) {
        const outgoing = links.find(l => {
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            return sId === State.userId && tId === node.id && isDirected(l.type);
        });
        const incoming = links.find(l => {
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            return sId === node.id && tId === State.userId && isDirected(l.type);
        });
        const undirected = links.find(l => {
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            return !isDirected(l.type) && ((sId === State.userId && tId === node.id) || (sId === node.id && tId === State.userId));
        });

        const mutualCrush = outgoing && incoming && outgoing.type === 'CRUSH' && incoming.type === 'CRUSH';

        const canMessage = Boolean(outgoing || incoming || undirected);
        const canManageRelationship = Boolean(outgoing || undirected);
        const activeRel = outgoing || undirected;
        if (activeRel && !statusHtml) {
            const style = CONFIG.relStyles[activeRel.type] || { color: '#fff' };
            statusHtml = `<div style="color:${style.color}">${getRelLabel(activeRel.type)}</div>`;
        }

        if (outgoing) {
            const style = CONFIG.relStyles[outgoing.type] || { color: '#fff' };
            if (isDirected(outgoing.type)) {
                statusHtml += `<div style="color:${style.color}">You → ${escapeHtml(node.name)}: ${getRelLabel(outgoing.type)}</div>`;
            } else {
                statusHtml += `<div style="color:${style.color}">${getRelLabel(outgoing.type)}</div>`;
            }
        }

        if (incoming) {
            const style = CONFIG.relStyles[incoming.type] || { color: '#fff' };
            if (isDirected(incoming.type)) {
                statusHtml += `<div style="color:${style.color}">${escapeHtml(node.name)} → You: ${getRelLabel(incoming.type)}</div>`;
            }
        }

        if (!outgoing && !incoming && node.last_msg_id > 0) {
            statusHtml += `<div style="color:#94a3b8">History available</div>`;
        }

        if (mutualCrush) {
            statusHtml += `<div style="margin-top:6px; color:#f472b6; font-weight:bold;">💞 Mutual Crush</div>`;
        }

        if(canManageRelationship) {
            const style = CONFIG.relStyles[activeRel.type] || { color: '#fff' };
            const options = RELATION_TYPES.map(t =>
                `<option value="${t}" ${activeRel.type === t ? 'selected' : ''}>${getRelLabel(t)}</option>`
            ).join('');

            actionHtml = `
                <div style="margin-top:10px; padding:8px; background:rgba(255,255,255,0.1); border-radius:4px; text-align:center;">
                    ${statusHtml || 'Connected'}
                </div>

                <div style="margin-top:8px;">
                     <select id="update-rel-type" style="width:70%; padding:6px; background:#1e293b; color:white; border:1px solid #475569; border-radius:4px;">
                        ${options}
                    </select>
                    <button class="action-btn" style="width:25%; display:inline-block;" data-action="update-rel" data-user-id="${node.id}">Update</button>
                </div>

                <button class="action-btn" data-action="open-chat" data-user-id="${node.id}">💬 Message</button>
                <button class="action-btn" style="background:#ef4444; margin-top:8px;" data-action="remove-rel" data-user-id="${node.id}">💔 Remove</button>
            `;
        } else if (canMessage) {
            const statusBlock = statusHtml ? `
                <div style="margin-top:10px; padding:8px; background:rgba(255,255,255,0.1); border-radius:4px; text-align:center;">
                    ${statusHtml}
                </div>
            ` : '';
            const preferredType = incoming && incoming.type === 'CRUSH' ? 'CRUSH' : null;
            const options = RELATION_TYPES.map(t => `<option value="${t}" ${preferredType === t ? 'selected' : ''}>Request ${getRelLabel(t)}</option>`).join('');
            actionHtml = `
                ${statusBlock}
                <button class="action-btn" data-action="open-chat" data-user-id="${node.id}">💬 Message</button>
                <select id="req-type" style="width:100%; padding:8px; margin-top:10px; background:#1e293b; color:white; border:1px solid #475569; border-radius:4px;">
                    ${options}
                </select>
                <button class="action-btn" data-action="send-request" data-user-id="${node.id}">🚀 Send Request</button>
            `;
        } else {
            if (node.last_msg_id > 0) {
                 actionHtml += `
                    <button class="action-btn" style="background:#64748b; margin-bottom:8px;" data-action="open-chat" data-user-id="${node.id}">📜 History</button>
                `;
            }

            const preferredType = incoming && incoming.type === 'CRUSH' ? 'CRUSH' : null;
            const options = RELATION_TYPES.map(t => `<option value="${t}" ${preferredType === t ? 'selected' : ''}>Request ${getRelLabel(t)}</option>`).join('');
            actionHtml += `
                <select id="req-type" style="width:100%; padding:8px; margin-top:10px; background:#1e293b; color:white; border:1px solid #475569; border-radius:4px;">
                    ${options}
                </select>
                <button class="action-btn" data-action="send-request" data-user-id="${node.id}">🚀 Send Request</button>
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

    const actionButtons = dataDiv.querySelectorAll('[data-action]');
    actionButtons.forEach(btn => {
        const targetId = parseInt(btn.getAttribute('data-user-id'));
        if (btn.dataset.action === 'open-chat') {
            btn.addEventListener('click', () => window.openChat(targetId, node.name));
        }
        if (btn.dataset.action === 'remove-rel') {
            btn.addEventListener('click', () => window.removeRel(targetId));
        }
        if (btn.dataset.action === 'send-request') {
            btn.addEventListener('click', () => window.sendRequest(targetId));
        }
        if (btn.dataset.action === 'update-rel') {
            btn.addEventListener('click', () => window.updateRel(targetId));
        }
    });
}

function showLinkInspector(link) {
    const panel = document.getElementById('inspector-panel');
    const dataDiv = document.getElementById('inspector-data');
    panel.style.display = 'block';

    const style = CONFIG.relStyles[link.type] || { color: '#fff', label: link.type };

    const sourceName = escapeHtml(link.source.name);
    const targetName = escapeHtml(link.target.name);
    const isMutualCrush = link.displayLabel && link.displayLabel.includes('↔');
    const directionLabel = isDirected(link.type) ? (isMutualCrush ? '↔' : '→') : '—';

    dataDiv.innerHTML = `
        <div class="inspector-title" style="color:${style.color}; text-align:center; font-weight:bold; font-size:1.2em;">${style.label}</div>
        <div style="display:flex; justify-content:space-around; align-items:center; margin: 20px 0;">
            <div style="text-align:center">
                <img src="${link.source.avatar}" style="width:40px; height:40px; border-radius:50%;">
                <div style="font-size:0.8em;">${sourceName}</div>
            </div>
            <div style="font-size:1.5em; opacity:0.5;">${directionLabel}</div>
            <div style="text-align:center">
                <img src="${link.target.avatar}" style="width:40px; height:40px; border-radius:50%;">
                <div style="font-size:0.8em;">${targetName}</div>
            </div>
        </div>
        ${isMutualCrush ? '<div style="text-align:center; color:#f472b6; font-weight:bold;">💞 Mutual Crush</div>' : ''}
    `;
}

window.showToast = showToast;
