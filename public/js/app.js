import { fetchGraphData, syncReadReceipts } from './api.js';
import { createGraph, animateGraph, initStarfieldBackground, disposeLinkVisual, transitionCamera } from './graph.js';
import { initUI, updateRequestsUI, updateNotificationHUD, updateConnectionPanel, showToast, escapeHtml, getRelLabel } from './ui.js';

if (!window.APP_CONFIG) {
    console.error('APP_CONFIG is missing. Unable to initialize application configuration.');
}

const CONFIG = window.APP_CONFIG ? {
    pollInterval: 3000,
    relStyles: window.APP_CONFIG.RELATION_STYLES,
    directedTypes: window.APP_CONFIG.DIRECTED_RELATION_TYPES || []
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
    nodeById: new Map(),
    selectedNodeId: null
};

let Graph = null;
let pollTimer = null;
let hiddenPollSkip = false;

export async function initApp(userId) {
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

    // [MOBILE-REFACTOR-START]
    window.Graph = Graph;
    // [MOBILE-REFACTOR-END]

    window.handleNodeClick = handleNodeClick;
    window.lookAtNode = lookAtNode;
    window.resetFocus = resetFocus;

    initUI({ state: State, config: CONFIG, relationTypes: RELATION_TYPES, refreshData: loadGraphData });

    await hydrateReadReceipts();
    await loadGraphData();

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
    let nextDelay = document.hidden ? Math.max(CONFIG.pollInterval, 10000) : CONFIG.pollInterval;
    try {
        if (document.hidden && hiddenPollSkip) {
            hiddenPollSkip = false;
            scheduleNextPoll(nextDelay);
            return;
        }

        const response = await fetchGraphData({ etag: State.etag, lastUpdate: State.lastUpdate, wait: true });
        if (response.status === 304 || !response.data) {
            nextDelay = response.timedOut ? 0 : nextDelay;
            return;
        }

        if (response.etag) State.etag = response.etag;
        applyGraphPayload(response.data);
    } catch (e) {
        console.error('Polling error:', e);
    } finally {
        hiddenPollSkip = document.hidden ? !hiddenPollSkip : false;
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
    State.graphData.nodes.forEach(node => { node.degree = 0; });
    State.graphData.links.forEach(link => {
        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;
        const sourceNode = State.nodeById.get(sId);
        const targetNode = State.nodeById.get(tId);
        if (sourceNode) sourceNode.degree = (sourceNode.degree || 0) + 1;
        if (targetNode) targetNode.degree = (targetNode.degree || 0) + 1;
    });

    // Sync last message ids using links
    // 优先使用增量数据 data.links，如果没有则使用全量 State.graphData.links
    const linksToProcess = data.links || State.graphData.links || [];
    linksToProcess.forEach(link => {
        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;
        const lastMsgId = parseInt(link.last_msg_id || 0);

        // 如果没有有效消息ID，直接跳过
        if (!lastMsgId) return;

        // 【核心修复】逻辑修正：
        // 1. 识别谁是“对方” (Peer)。
        // 2. 只更新“对方”的节点状态。
        // 3. 绝对不要更新 State.userId (我自己)，防止给自己弹通知。
        
        let peerId = null;
        if (sId === State.userId) {
            peerId = tId;
        } else if (tId === State.userId) {
            peerId = sId;
        } else {
            // 这条连线与我无关（比如是别人的对话），直接忽略
            return;
        }

        const peerNode = State.nodeById.get(peerId);
        // 只有 peerNode 存在且确实是对方时，才更新状态
        if (peerNode) {
            updateNodeLastMessage(peerNode, lastMsgId);
        }
    });

    updateRequestsUI(data.requests || []);
    updateNotificationHUD(State.graphData.nodes);
    updateConnectionPanel();

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

    if (State.selectedNodeId) {
        const updatedNode = State.nodeById.get(State.selectedNodeId);
        const panel = document.getElementById('inspector-panel');
        if (updatedNode && panel && panel.style.display !== 'none') {
            showNodeInspector(updatedNode);
        }
    }
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

        // 【核心修复】保护本地状态：
        // 只有当后端发来有效的 ID (>0) 时才更新。
        // 忽略后端的 0，因为那是 api/data.php 的默认占位符。
        if (typeof last_msg_id !== 'undefined' && last_msg_id > 0) {
            merged.last_msg_id = last_msg_id;
        } 
        
        // 兜底：如果合并后完全没有这个字段（既没有旧值，新值也是0），才初始化为0
        if (typeof merged.last_msg_id === 'undefined') {
            merged.last_msg_id = 0;
        }
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

    const currentLinks = new Map(State.graphData.links.map(l => [linkKey(l), l]));
    const linkMap = new Map((incremental && !State.isFirstLoad) ? currentLinks : []);

    if (!incremental && links.length !== previousLinkCount) {
        hasTopologyChanges = true;
    }

    links.forEach(l => {
        const key = linkKey(l);
        if (l.deleted === true) {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            const existing = linkMap.get(key) || currentLinks.get(key);
            if (existing) {
                disposeLinkVisual(existing);
            }

            linkMap.delete(key);
            if (!isDirected(l.type)) {
                const reverseKey = `${t}-${s}`;
                const reverseExisting = linkMap.get(reverseKey) || currentLinks.get(reverseKey);
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

        const existing = currentLinks.get(key) || {};

        // If type changed (e.g. Request Accepted), flag as topology change
        if (existing.type !== undefined && existing.type !== l.type) {
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
                l.displayLabel = getRelLabel(l.type);
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
            forward.isMutual = true;
            backward.isMutual = true;
            forward.displayLabel = `${getRelLabel(forward.type)}`;
            forward.hideLabel = false;
            backward.displayLabel = `${getRelLabel(backward.type)}`;
            backward.hideLabel = true;
            return;
        }

        linksForPair.forEach(l => {
            l.displayLabel = getRelLabel(l.type);
            l.hideLabel = false;
        });
    });

    linksArray.forEach(link => {
        if (!isDirected(link.type)) {
            link.displayLabel = getRelLabel(link.type);
            link.hideLabel = false;
        } else if (!link.displayLabel) {
            link.displayLabel = getRelLabel(link.type);
            link.hideLabel = false;
        }
    });

    State.graphData.links = linksArray;

    return hasTopologyChanges;
}

function updateNodeLastMessage(node, serverLastMsgId) {
    const normalized = parseInt(serverLastMsgId);
    if (normalized <= (node.last_msg_id || 0)) return;

    node.last_msg_id = normalized;

    const readKey = `read_msg_id_${State.userId}_${node.id}`;
    const localReadId = parseInt(localStorage.getItem(readKey) || '0');

    if (normalized > localReadId) {
        if (State.activeChats.has(node.id)) {
            if (window.loadMsgs) {
                window.loadMsgs(node.id);
            }
        } else {
            const toastKey = `last_toasted_msg_${State.userId}_${node.id}`;
            const lastToastedId = parseInt(sessionStorage.getItem(toastKey) || '0');

            if (normalized > lastToastedId) {
                if (window.showToast) {
                    window.showToast(
                        `New message from ${node.name}`,
                        'info',
                        3000,
                        () => window.openChat(node.id, node.name),
                        { userId: node.id }
                    );
                }
                sessionStorage.setItem(toastKey, normalized);
            }

            node.hasActiveNotification = true;
        }
    }
}

function tweenMaterialOpacity(material, targetOpacity) {
    if (!material) return;

    material.transparent = true;
    const start = material.opacity ?? 1;
    const duration = 180;
    const startTime = performance.now();

    const step = () => {
        const t = Math.min(1, (performance.now() - startTime) / duration);
        material.opacity = THREE.MathUtils.lerp(start, targetOpacity, t);
        if (t < 1) requestAnimationFrame(step);
    };

    step();
}

function fadeObjectOpacity(object3d, targetOpacity) {
    if (!object3d) return;

    if (Array.isArray(object3d.material)) {
        object3d.material.forEach(mat => tweenMaterialOpacity(mat, targetOpacity));
    } else if (object3d.material) {
        tweenMaterialOpacity(object3d.material, targetOpacity);
    }

    if (object3d.children && object3d.children.length) {
        object3d.children.forEach(child => fadeObjectOpacity(child, targetOpacity));
    }
}

function resetGhosting() {
    if (!Graph) return;

    const data = Graph.graphData();
    (data.nodes || []).forEach(node => {
        if (node.__threeObj) {
            node.__threeObj.visible = true;
            fadeObjectOpacity(node.__threeObj, 1);
        }
    });

    (data.links || []).forEach(link => {
        if (link.__group) {
            link.__group.visible = true;
            fadeObjectOpacity(link.__group, 1);
        }
    });
}

function buildAdjacency(links) {
    const adjacency = new Map();

    links.forEach(link => {
        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;

        if (!adjacency.has(sId)) adjacency.set(sId, new Set());
        if (!adjacency.has(tId)) adjacency.set(tId, new Set());

        adjacency.get(sId).add(tId);
        adjacency.get(tId).add(sId);
    });

    return adjacency;
}

function computeTwoDegreeDepths(adjacency, centerNodeId) {
    const depthMap = new Map();
    const queue = [];

    depthMap.set(centerNodeId, 0);
    queue.push(centerNodeId);

    while (queue.length) {
        const current = queue.shift();
        const currentDepth = depthMap.get(current);
        if (currentDepth >= 2) continue;

        const neighbors = adjacency.get(current) || [];
        neighbors.forEach(neighbor => {
            if (!depthMap.has(neighbor)) {
                depthMap.set(neighbor, currentDepth + 1);
                queue.push(neighbor);
            }
        });
    }

    return depthMap;
}

function applyFocusGhosting(centerNodeId) {
    if (!Graph) return;

    const { nodes = [], links = [] } = Graph.graphData();

    const adjacency = buildAdjacency(links);
    const depthMap = computeTwoDegreeDepths(adjacency, centerNodeId);

    const visibleNodeIds = new Set(depthMap.keys());
    const visibleLinks = new Set();

    links.forEach(link => {
        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;

        const sDepth = depthMap.get(sId);
        const tDepth = depthMap.get(tId);

        const withinTwoDegrees = sDepth !== undefined && tDepth !== undefined;
        const edgeAllowed = withinTwoDegrees && !(sDepth === 2 && tDepth === 2);

        if (edgeAllowed) {
            visibleLinks.add(link);
        }
    });

    nodes.forEach(node => {
        const isVisible = visibleNodeIds.has(node.id);
        if (node.__threeObj) {
            node.__threeObj.visible = isVisible;
            if (isVisible) fadeObjectOpacity(node.__threeObj, 1);
        }
    });

    links.forEach(link => {
        const isVisible = visibleLinks.has(link);
        if (link.__group) {
            link.__group.visible = isVisible;
            fadeObjectOpacity(link.__group, isVisible ? 1 : 0);
        }
    });
}

function handleNodeClick(node) {
    if (State.selectedNodeId === node.id) return;
    State.selectedNodeId = node.id;
    const dist = 150;
    const v = new THREE.Vector3(node.x, node.y, node.z || 0);
    if (v.lengthSq() === 0) v.set(0, 0, 1);

    const camPos = v.clone().normalize().multiplyScalar(dist).add(v);
    camPos.y += 40;

    transitionCamera(
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

    applyFocusGhosting(node.id);

    showNodeInspector(node);
}

export function lookAtNode(nodeId) {
    const node = State.nodeById.get(nodeId) || State.graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const dist = 150;
    const target = new THREE.Vector3(node.x, node.y, node.z || 0);
    if (target.lengthSq() === 0) target.set(0, 0, 1);
    const camPos = target.clone().normalize().multiplyScalar(dist).add(target);
    camPos.y += 40;

    transitionCamera({ x: camPos.x, y: camPos.y, z: camPos.z }, node, 1500);
}

function handleLinkClick(link) {
    resetGhosting();

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
    State.selectedNodeId = null;
    State.highlightNodes.clear();
    State.highlightLinks.clear();
    State.highlightLink = null;

    resetGhosting();

    Graph.nodeColor(Graph.nodeColor());
    Graph.linkColor(Graph.linkColor());

    const inspector = document.getElementById('inspector-panel');
    if (inspector) {
        inspector.style.display = 'none';
    }
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
    const degreeCount = node.degree || 0;

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
        // Allow management if there is ANY link (Outgoing, Incoming, or Undirected)
        const canManageRelationship = Boolean(outgoing || incoming || undirected);
        const activeRel = outgoing || undirected;
        if (mutualCrush) {
            statusHtml = `
                <div class="rel-badge mutual">
                    <span class="rel-icon">💞</span>
                    <span class="rel-label">Mutual Crush</span>
                </div>
            `;
        } else {
            if (outgoing) {
                const style = CONFIG.relStyles[outgoing.type] || { color: '#fff' };
                statusHtml += `
                    <div class="rel-badge outgoing" style="border-color:${style.color}">
                        <span class="rel-label" style="color:${style.color}">${getRelLabel(outgoing.type)}</span>
                        <span class="rel-tag">Sent ↗</span>
                    </div>
                `;
            }

            if (incoming) {
                const style = CONFIG.relStyles[incoming.type] || { color: '#fff' };
                statusHtml += `
                    <div class="rel-badge incoming" style="border-color:${style.color}">
                        <span class="rel-label" style="color:${style.color}">${getRelLabel(incoming.type)}</span>
                        <span class="rel-tag">Received ↙</span>
                    </div>
                `;
            }

            if (!outgoing && !incoming && undirected) {
                const style = CONFIG.relStyles[undirected.type] || { color: '#fff' };
                statusHtml += `
                    <div class="rel-badge" style="border-color:${style.color}">
                        <span class="rel-label" style="color:${style.color}">${getRelLabel(undirected.type)}</span>
                        <span class="rel-tag">Connected</span>
                    </div>
                `;
            }

            if (!statusHtml && node.last_msg_id > 0) {
                statusHtml += `<div class="status-block">History available</div>`;
            }
        }

        const actionButtons = [];
        if (canMessage || node.last_msg_id > 0) {
            actionButtons.push(`<button class="icon-btn" data-action="open-chat" data-user-id="${node.id}">💬<span>Message</span></button>`);
        }
        if (canManageRelationship) {
            actionButtons.push(`<button class="icon-btn danger" data-action="remove-rel" data-user-id="${node.id}">💔<span>Remove</span></button>`);
        }

        const preferredType = incoming && incoming.type === 'CRUSH' ? 'CRUSH' : null;
        const baseOptions = (canManageRelationship && activeRel)
            ? RELATION_TYPES.filter(t => t !== activeRel.type)
            : RELATION_TYPES;
        const selectOptions = baseOptions
            .map(t => `<option value="${t}" ${preferredType === t ? 'selected' : ''}>${getRelLabel(t)}</option>`)
            .join('');

        if (canManageRelationship) {
            actionHtml = `
                ${statusHtml ? `<div class="status-block">${statusHtml}</div>` : ''}
                <div class="chip-grid">
                    <div class="chip"><span>Connections</span><strong>${relationsCount}</strong></div>
                    <div class="chip"><span>Degree</span><strong>${degreeCount}</strong></div>
                </div>
                <div class="inspector-actions">${actionButtons.join('')}</div>
                <div class="action-form">
                    <select id="update-rel-type" class="select-compact">
                        ${selectOptions}
                    </select>
                    <button class="pill-btn primary" data-action="update-rel" data-user-id="${node.id}">Update</button>
                </div>
            `;
        } else if (canMessage) {
            actionHtml = `
                ${statusHtml ? `<div class="status-block">${statusHtml}</div>` : ''}
                <div class="chip-grid">
                    <div class="chip"><span>Connections</span><strong>${relationsCount}</strong></div>
                    <div class="chip"><span>Degree</span><strong>${degreeCount}</strong></div>
                </div>
                <div class="inspector-actions">${actionButtons.join('')}</div>
                <div class="action-form">
                    <select id="req-type" class="select-compact">
                        ${selectOptions}
                    </select>
                    <button class="pill-btn primary" data-action="send-request" data-user-id="${node.id}">Request</button>
                </div>
            `;
        } else {
            actionHtml = `
                ${statusHtml ? `<div class="status-block">${statusHtml}</div>` : ''}
                <div class="chip-grid">
                    <div class="chip"><span>Connections</span><strong>${relationsCount}</strong></div>
                    <div class="chip"><span>Degree</span><strong>${degreeCount}</strong></div>
                </div>
                <div class="inspector-actions">${actionButtons.join('')}</div>
                <div class="action-form">
                    <select id="req-type" class="select-compact">
                        ${selectOptions}
                    </select>
                    <button class="pill-btn primary" data-action="send-request" data-user-id="${node.id}">Send</button>
                </div>
            `;
        }
    }

    if (!actionHtml) {
        actionHtml = `
            <div class="chip-grid">
                <div class="chip"><span>Connections</span><strong>${relationsCount}</strong></div>
                <div class="chip"><span>Degree</span><strong>${degreeCount}</strong></div>
            </div>
        `;
    }

    dataDiv.innerHTML = `
        <img src="${node.avatar}" class="inspector-avatar">
        <div class="inspector-title">${escapeHtml(node.name)}</div>
        <div class="inspector-subtitle">User ID: ${node.id}</div>
        <div class="inspector-content signature-display">${escapeHtml(node.signature)}</div>
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
    const isMutualCrush = link.isMutual === true;
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
