import { postData } from './api.js';

let State;
let refreshDataFn;
let relationTypes = [];

export function initUI({ state, config, relationTypes: relTypes, refreshData }) {
    State = state;
    relationTypes = relTypes || [];
    refreshDataFn = refreshData;

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }

    const sigBtn = document.getElementById('signature-update-btn');
    if (sigBtn) {
        sigBtn.addEventListener('click', updateSignature);
    }

    const sigInput = document.getElementById('signature-input');
    if (sigInput) {
        sigInput.addEventListener('input', (e) => {
            const len = e.target.value.length;
            const counter = document.getElementById('signature-counter');
            if (counter) counter.innerText = `${len} / 160`;
        });
    }

    const zoomBtn = document.getElementById('zoom-btn');
    if (zoomBtn) {
        zoomBtn.addEventListener('click', () => {
            const myNode = State.graphData.nodes.find(n => n.id === State.userId);
            if (myNode && window.handleNodeClick) {
                window.handleNodeClick(myNode);
            }
        });
    }

    window.sendRequest = sendRequest;
    window.updateRel = updateRel;
    window.acceptReq = acceptReq;
    window.rejectReq = rejectReq;
    window.removeRel = removeRel;
    window.openChat = openChat;
    window.closeChat = closeChat;
    window.loadMsgs = loadMsgs;
    window.sendMsg = sendMsg;
}

export function escapeHtml(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function updateHudVisibility() {
    const hud = document.getElementById('notif-hud');
    const toastList = document.getElementById('toast-list');
    const reqList = document.getElementById('requests-container');
    const unreadList = document.getElementById('unread-msgs-container');

    const hasToasts = toastList && toastList.children.length > 0;
    const hasReqs = reqList && reqList.style.display !== 'none';
    const hasUnreads = unreadList && unreadList.style.display !== 'none';

    if (hud) {
        hud.style.display = (hasToasts || hasReqs || hasUnreads) ? 'block' : 'none';
    }
}

export function updateRequestsUI(requests) {
    const container = document.getElementById('requests-container');
    const list = document.getElementById('req-list');

    if (!container || !list) return;

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

export function updateUnreadMessagesUI(nodes) {
    const container = document.getElementById('unread-msgs-container');
    const list = document.getElementById('unread-msgs-list');
    if (!container || !list) return;

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
    if (!resultsContainer) return;

    if (!searchTerm) {
        resultsContainer.innerHTML = '';
        resultsContainer.style.display = 'none';
        return;
    }

    const hits = State.graphData.nodes.filter(n =>
        n.name.toLowerCase().includes(searchTerm) ||
        String(n.id) === searchTerm ||
        (n.username && n.username.toLowerCase().includes(searchTerm))
    );

    if (hits.length === 0) {
        resultsContainer.innerHTML = '<div class="search-result-item">No users found.</div>';
    } else {
        resultsContainer.innerHTML = hits.map(n => `
            <div class="search-result-item" onclick="window.handleNodeClick(State.graphData.nodes.find(user => user.id === ${n.id})); document.getElementById('search-input').value=''; document.getElementById('search-results').style.display='none';">
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
                const counter = document.getElementById('signature-counter');
                if (counter) counter.innerText = '0 / 160';
                if (refreshDataFn) refreshDataFn();
            } else {
                showToast("Error: " + data.error, "error");
            }
        });
}

export function showToast(message, type = 'success', duration = 3000, onClick = null, dataAttrs = {}) {
    const container = document.getElementById('toast-list');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toast.style.position = 'relative';
    toast.style.transform = 'none';
    toast.style.marginBottom = '8px';

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

function sendRequest(toId) {
    const typeSelect = document.getElementById('req-type');
    const type = typeSelect ? typeSelect.value : relationTypes[0];
    postData('api/relations.php', { action: 'request', to_id: toId, type: type })
        .then(res => res.json())
        .then(res => {
            if(res.success) {
                showToast('Request Sent!');
                if (refreshDataFn) refreshDataFn();
            } else {
                showToast(res.error || 'Failed to send request', 'error');
            }
        });
}

function updateRel(toId) {
    const typeSelect = document.getElementById('update-rel-type');
    const type = typeSelect ? typeSelect.value : relationTypes[0];
    postData('api/relations.php', { action: 'update', to_id: toId, type: type })
        .then(res => res.json())
        .then(res => {
            if(res.success) {
                showToast('Relationship updated!');
                if (refreshDataFn) refreshDataFn();
            } else {
                showToast(res.error || 'Failed to update', 'error');
            }
        });
}

function acceptReq(reqId) {
    postData('api/relations.php', { action: 'accept_request', request_id: reqId }).then(() => refreshDataFn && refreshDataFn());
}

function rejectReq(reqId) {
    postData('api/relations.php', { action: 'reject_request', request_id: reqId }).then(() => refreshDataFn && refreshDataFn());
}

function removeRel(toId) {
    if(!confirm("Are you sure you want to remove this relationship?")) return;
    postData('api/relations.php', { action: 'remove', to_id: toId }).then(() => refreshDataFn && refreshDataFn());
}

function openChat(userId, encodedName) {
    const userName = decodeURIComponent(encodedName);
    const chatHud = document.getElementById('chat-hud');
    if (!chatHud) return;
    chatHud.style.pointerEvents = 'auto';

    State.activeChats.add(userId);

    const node = State.graphData.nodes.find(n => n.id === userId);
    if(node) {
        const lastId = node.last_msg_id;
        localStorage.setItem(`read_msg_id_${State.userId}_${userId}`, lastId);

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
        updateUnreadMessagesUI(State.graphData.nodes);
    }

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
    div.setAttribute('data-last-id', '0');
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

    window.loadMsgs(userId);

    const msgsContainer = document.getElementById(`msgs-${userId}`);
    msgsContainer.addEventListener('scroll', () => {
        if(msgsContainer.scrollTop === 0) {
            const firstMsg = msgsContainer.firstElementChild;
            if (firstMsg) {
                const oldestId = parseInt(firstMsg.getAttribute('data-id'));
                if (oldestId > 1) {
                    window.loadMsgs(userId, oldestId);
                }
            }
        }
    });
}

function closeChat(userId) {
    const win = document.getElementById(`chat-${userId}`);
    if(win) win.remove();
    State.activeChats.delete(userId);

    if(document.getElementById('chat-hud').children.length === 0) {
        document.getElementById('chat-hud').style.pointerEvents = 'none';
    }
}

function loadMsgs(userId, beforeId = 0) {
    const container = document.getElementById(`msgs-${userId}`);
    if(!container) return;

    const isPagination = beforeId > 0;

    const url = `api/messages.php?action=retrieve&to_id=${userId}` + (isPagination ? `&before_id=${beforeId}` : '');

    fetch(url)
    .then(r => r.json())
    .then(data => {
        if(data.error) return;

        if (data.length === 0 && isPagination) {
             return;
        }

        const html = data.map(m => `
            <div class="msg-row" data-id="${m.id}" style="text-align:${m.from_id == State.userId ? 'right' : 'left'}; margin-bottom:4px;">
                <span style="background:${m.from_id == State.userId ? '#6366f1' : '#334155'}; padding:4px 8px; border-radius:4px; display:inline-block; max-width:80%; word-break:break-word;">
                    ${escapeHtml(m.message)}
                </span>
            </div>
        `).join('');

        if (isPagination) {
            const oldHeight = container.scrollHeight;
            container.insertAdjacentHTML('afterbegin', html);
            container.scrollTop = container.scrollHeight - oldHeight;
        } else {
            if (container.innerHTML === 'Loading...') {
                container.innerHTML = html;
                container.scrollTop = container.scrollHeight;
            } else {
                const lastChild = container.lastElementChild;
                const currentMaxId = lastChild ? parseInt(lastChild.getAttribute('data-id')) : 0;
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

                    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
                    if (isNearBottom) {
                        container.scrollTop = container.scrollHeight;
                    } else {
                        showToast('New message received (Scroll down)', 'info');
                    }
                }
            }
        }

        if (data.length > 0) {
            const newest = data[data.length - 1];
            if (!isPagination) {
                const newMax = newest.id;
                document.getElementById(`chat-${userId}`).setAttribute('data-last-id', newMax);
                localStorage.setItem(`read_msg_id_${State.userId}_${userId}`, newMax);

                postData('api/messages.php', {
                    action: 'mark_read',
                    peer_id: userId,
                    last_read_msg_id: newMax
                });
            }
        }
    });
}

function sendMsg(e, userId) {
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
            window.loadMsgs(userId);
        } else {
            showToast(res.error || 'Failed to send', 'error');
        }
    });
}
