const MobileApp = {
    initialized: false,
    elements: {},
    searchTimer: null,
    viewportListener: null,

    init() {
        if (this.initialized || window.innerWidth > 768) return;
        this.initialized = true;

        this.cacheElements();
        this.bindNavigation();
        this.bindSearch();
        this.bindChat();
        this.bindSheet();

        this.elements.shell.style.display = 'block';
    },

    cacheElements() {
        this.elements = {
            shell: document.getElementById('mobile-shell'),
            sheet: document.getElementById('mobile-sheet'),
            sheetBackdrop: document.getElementById('mobile-sheet-backdrop'),
            sheetContent: document.getElementById('sheet-content'),
            nav: document.getElementById('mobile-nav'),
            searchBtn: document.getElementById('mobile-btn-search'),
            searchView: document.getElementById('mobile-search-view'),
            searchInput: document.getElementById('mobile-search-input'),
            searchCancel: document.getElementById('search-btn-cancel'),
            searchResults: document.getElementById('mobile-search-results'),
            chatView: document.getElementById('mobile-chat-view'),
            chatClose: document.getElementById('chat-btn-close'),
            chatList: document.getElementById('mobile-chat-list'),
            chatName: document.getElementById('chat-user-name'),
            chatInput: document.getElementById('mobile-chat-input'),
            chatSend: document.getElementById('mobile-chat-send'),
        };
    },

    bindNavigation() {
        const { nav } = this.elements;
        if (!nav) return;

        nav.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                nav.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.hideFullScreens();
                this.closeSheet();
            });
        });
    },

    bindSearch() {
        const { searchBtn, searchView, searchCancel, searchInput } = this.elements;
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                this.hideFullScreens();
                searchView?.classList.remove('hidden');
                searchInput?.focus();
            });
        }
        if (searchCancel) {
            searchCancel.addEventListener('click', () => this.hideFullScreens());
        }
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
        }
    },

    bindChat() {
        const { chatClose, chatSend, chatInput } = this.elements;
        if (chatClose) chatClose.addEventListener('click', () => this.closeChat());
        if (chatSend) chatSend.addEventListener('click', () => this.sendChat());
        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendChat();
                }
            });
        }
    },

    bindSheet() {
        const { sheetBackdrop } = this.elements;
        if (sheetBackdrop) {
            sheetBackdrop.addEventListener('click', () => this.closeSheet());
        }
    },

    hideFullScreens() {
        const { chatView, searchView, sheetBackdrop, sheet } = this.elements;
        chatView?.classList.add('hidden');
        searchView?.classList.add('hidden');
        this.removeViewportListener();
        if (sheetBackdrop) sheetBackdrop.classList.add('hidden');
        if (sheet) sheet.classList.add('hidden');
    },

    openInspector(node) {
        const { sheet, sheetBackdrop, sheetContent } = this.elements;
        if (!sheet || !sheetContent || !sheetBackdrop) return;

        const safeName = (node?.name || 'Unknown').toString();
        const safeUser = (node?.username || 'user').toString();
        sheetContent.innerHTML = `
            <div class="inspector-card">
                <div class="inspector-title">${safeName}</div>
                <div class="inspector-handle">@${safeUser}</div>
                <div class="inspector-actions">
                    <button id="mobile-open-chat">Message</button>
                </div>
            </div>
        `;

        const chatBtn = document.getElementById('mobile-open-chat');
        if (chatBtn) {
            chatBtn.addEventListener('click', () => this.openChat(node));
        }

        sheet.classList.remove('hidden');
        sheet.classList.add('visible');
        sheetBackdrop.classList.remove('hidden');
        sheetBackdrop.classList.add('visible');
    },

    closeSheet() {
        const { sheet, sheetBackdrop } = this.elements;
        sheet?.classList.add('hidden');
        sheet?.classList.remove('visible');
        sheetBackdrop?.classList.add('hidden');
        sheetBackdrop?.classList.remove('visible');
    },

    openChat(node) {
        const { chatView, chatName, chatList } = this.elements;
        this.closeSheet();
        if (chatName) chatName.textContent = node?.name || 'Chat';
        if (chatList) chatList.innerHTML = '';
        chatView?.classList.remove('hidden');
        this.bindViewportResize();
        this.adjustViewportHeight();
    },

    closeChat() {
        const { chatView } = this.elements;
        chatView?.classList.add('hidden');
        this.removeViewportListener();
    },

    sendChat() {
        const { chatInput, chatList } = this.elements;
        const text = chatInput?.value?.trim();
        if (!text) return;
        const bubble = document.createElement('div');
        bubble.textContent = text;
        bubble.style.padding = '10px 12px';
        bubble.style.margin = '6px 0';
        bubble.style.borderRadius = '12px';
        bubble.style.background = 'rgba(168, 85, 247, 0.2)';
        bubble.style.border = '1px solid rgba(168, 85, 247, 0.35)';
        chatList?.appendChild(bubble);
        if (chatInput) chatInput.value = '';
        chatList?.scrollTo({ top: chatList.scrollHeight, behavior: 'smooth' });
    },

    handleSearchInput(value) {
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.runSearch(value), 200);
    },

    async runSearch(term) {
        const { searchResults } = this.elements;
        if (!searchResults) return;
        const query = term.trim();

        if (!query) {
            searchResults.innerHTML = '<div class="muted">Type to search</div>';
            return;
        }

        searchResults.innerHTML = '<div class="muted">Searching...</div>';
        try {
            const res = await fetch(`api/data.php?search=${encodeURIComponent(query)}`);
            const payload = res.ok ? await res.json() : null;
            const nodes = payload?.nodes || [];
            if (!nodes.length) {
                searchResults.innerHTML = '<div class="muted">No results</div>';
                return;
            }
            const list = nodes.slice(0, 20).map(n => `
                <div class="result-row" data-node-id="${n.id}">
                    <div class="result-name">${n.name || 'Unknown'}</div>
                    <div class="result-handle">@${n.username || ''}</div>
                </div>
            `).join('');
            searchResults.innerHTML = list;
            searchResults.querySelectorAll('.result-row').forEach(row => {
                row.addEventListener('click', () => {
                    this.hideFullScreens();
                    if (row.dataset.nodeId && window.handleNodeClick) {
                        const id = row.dataset.nodeId;
                        const node = (window.Graph?.graphData?.().nodes || []).find(n => `${n.id}` === `${id}`);
                        if (node) {
                            window.handleNodeClick(node);
                        }
                    }
                });
            });
        } catch (err) {
            console.error('Mobile search failed', err);
            searchResults.innerHTML = '<div class="muted">Search unavailable offline</div>';
        }
    },

    bindViewportResize() {
        if (!window.visualViewport) return;
        this.viewportListener = () => this.adjustViewportHeight();
        window.visualViewport.addEventListener('resize', this.viewportListener);
    },

    removeViewportListener() {
        if (this.viewportListener && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', this.viewportListener);
            this.viewportListener = null;
        }
    },

    adjustViewportHeight() {
        const { chatView } = this.elements;
        if (!chatView) return;
        const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        chatView.style.height = `${height}px`;
    }
};

if (typeof window !== 'undefined') {
    window.MobileApp = MobileApp;
    document.addEventListener('DOMContentLoaded', () => MobileApp.init());
}
