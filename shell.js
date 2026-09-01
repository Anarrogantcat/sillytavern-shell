
// ── 工具箱自定义排序/折叠（v1.13.0）──────────────────────────────
function initToolboxGroups() {
    const body = document.querySelector('.bench-body');
    if (!body) return;
    // 按 .tool-sec 将扁平结构运行时分组
    const children = [...body.children];
    const groups = [];
    let cur = null;
    for (const el of children) {
        if (el.classList && el.classList.contains('tool-sec')) {
            cur = { header: el, items: [] };
            groups.push(cur);
        } else if (cur) {
            cur.items.push(el);
        }
    }
    // 清空原 body，重建为 .tool-group
    body.innerHTML = '';
    for (const g of groups) {
        const wrap = document.createElement('div');
        wrap.className = 'tool-group';
        wrap.dataset.key = String(g.header.textContent || '').trim();
        const header = g.header.cloneNode(true);
        header.classList.add('tool-group-header');
        header.setAttribute('draggable', 'true');
        header.title = '拖拽排序，点击折叠/展开';
        const toggle = document.createElement('span');
        toggle.className = 'tool-group-toggle';
        toggle.textContent = '▾';
        header.appendChild(toggle);
        const content = document.createElement('div');
        content.className = 'tool-group-body';
        for (const item of g.items) content.appendChild(item);
        wrap.appendChild(header);
        wrap.appendChild(content);
        body.appendChild(wrap);
    }
    // 恢复排序/折叠
    const orderKey = 'toolboxGroupOrder';
    const collapsedKey = 'toolboxGroupCollapsed';
    let order = [];
    try { order = JSON.parse(localStorage.getItem(orderKey) || '[]'); } catch (_) {}
    const wraps = [...body.querySelectorAll('.tool-group')];
    for (const key of [...order].reverse()) {
        const w = wraps.find(x => x.dataset.key === key);
        if (w) body.insertBefore(w, body.firstChild);
    }
    let collapsed = [];
    try { collapsed = JSON.parse(localStorage.getItem(collapsedKey) || '[]'); } catch (_) {}
    const favKey = 'toolboxFavoriteGroups';
    const getFavorites = () => {
        try { return JSON.parse(localStorage.getItem(favKey) || '[]'); } catch (_) { return []; }
    };
    for (const w of wraps) {
        if (collapsed.includes(w.dataset.key)) w.classList.add('collapsed');
        const header = w.querySelector('.tool-group-header');
        // 收藏星标
        const star = document.createElement('span');
        star.className = 'tool-group-star';
        star.title = '收藏/取消收藏';
        star.setAttribute('role', 'button');
        star.textContent = '☆';
        header?.insertBefore(star, header.querySelector('.tool-group-toggle'));
        if (getFavorites().includes(w.dataset.key)) {
            w.classList.add('favorite');
            star.textContent = '★';
        }
        star?.addEventListener('click', (e) => {
            e.stopPropagation();
            const favs = getFavorites();
            const key = w.dataset.key;
            const idx = favs.indexOf(key);
            if (idx >= 0) favs.splice(idx, 1); else favs.push(key);
            localStorage.setItem(favKey, JSON.stringify(favs));
            w.classList.toggle('favorite', idx < 0);
            star.textContent = idx < 0 ? '★' : '☆';
        });
        header?.addEventListener('click', (e) => {
            if (Date.now() < suppressHeaderClick) return;
            if (e.target.closest('.tool-group-star')) return;
            w.classList.toggle('collapsed');
            let arr = [];
            try { arr = JSON.parse(localStorage.getItem(collapsedKey) || '[]'); } catch (_) {}
            if (w.classList.contains('collapsed')) { if (!arr.includes(w.dataset.key)) arr.push(w.dataset.key); }
            else arr = arr.filter(x => x !== w.dataset.key);
            localStorage.setItem(collapsedKey, JSON.stringify(arr));
        });
    }
    // 收藏组置顶
    for (const key of [...getFavorites()].reverse()) {
        const w = wraps.find(x => x.dataset.key === key);
        if (w) body.insertBefore(w, body.firstChild);
    }
    // 工具箱工具栏：搜索 + 展开/折叠
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbox-toolbar';
    toolbar.innerHTML = `
        <div class="toolbox-search-wrap">
            <input type="text" id="toolbox-search" class="tool-input" placeholder="搜索工具…">
            <button id="toolbox-search-clear" class="search-clear" type="button" title="清除搜索">&times;</button>
        </div>
        <div class="toolbox-toolbar-actions">
            <button id="toolbox-expand-all" class="btn-secondary btn-xs" type="button">全部展开</button>
            <button id="toolbox-collapse-all" class="btn-secondary btn-xs" type="button">全部折叠</button>
        </div>
    `;
    body.insertBefore(toolbar, body.firstChild);
    // 最近使用
    const recentBox = document.createElement('div');
    recentBox.id = 'toolbox-recent';
    recentBox.className = 'toolbox-recent hidden';
    body.insertBefore(recentBox, toolbar.nextSibling);
    const recentKey = 'toolboxRecent';
    const getRecent = () => {
        try { return JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch (_) { return []; }
    };
    function recordRecent(key) {
        const arr = getRecent().filter(x => x !== key);
        arr.unshift(key);
        if (arr.length > 6) arr.length = 6;
        localStorage.setItem(recentKey, JSON.stringify(arr));
        renderRecent();
    }
    function renderRecent() {
        const arr = getRecent();
        const chips = arr.map(key => {
            const w = body.querySelector(`.tool-group[data-key="${String(key).replace(/"/g, '\\"')}"]`);
            if (!w) return '';
            return `<button type="button" class="recent-chip" data-key="${String(key).replace(/"/g, '&quot;')}">${String(w.dataset.key).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</button>`;
        }).join('');
        if (!chips) { recentBox.classList.add('hidden'); recentBox.innerHTML = ''; return; }
        recentBox.classList.remove('hidden');
        recentBox.innerHTML = '<span class="recent-label">最近使用</span>' + chips;
        recentBox.querySelectorAll('.recent-chip').forEach(chip => chip.addEventListener('click', () => {
            const w = body.querySelector(`.tool-group[data-key="${String(chip.dataset.key).replace(/"/g, '\\"')}"]`);
            if (!w) return;
            if (searchInput) { searchInput.value = ''; applyToolboxSearch(); }
            w.classList.remove('collapsed');
            w.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    }
    body.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !btn.closest('.tool-group-body')) return;
        const w = btn.closest('.tool-group');
        if (w && w.dataset.key) recordRecent(w.dataset.key);
    });
    body.addEventListener('change', (e) => {
        const w = e.target.closest('.tool-group');
        if (w && w.dataset.key && (e.target.matches('select,input'))) recordRecent(w.dataset.key);
    });
    renderRecent();
    // 搜索过滤
    const searchInput = toolbar.querySelector('#toolbox-search');
    const searchClear = toolbar.querySelector('#toolbox-search-clear');
    function applyToolboxSearch() {
        const q = searchInput.value.trim().toLowerCase();
        searchClear.classList.toggle('hidden', !q);
        for (const w of body.querySelectorAll('.tool-group')) {
            const hit = !q || (w.textContent || '').toLowerCase().includes(q);
            w.style.display = hit ? '' : 'none';
            if (q && hit) w.classList.remove('collapsed');
        }
    }
    searchInput.addEventListener('input', applyToolboxSearch);
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        applyToolboxSearch();
        searchInput.focus();
    });
    toolbar.querySelector('#toolbox-expand-all').addEventListener('click', () => {
        for (const w of body.querySelectorAll('.tool-group')) w.classList.remove('collapsed');
        localStorage.setItem(collapsedKey, '[]');
    });
    toolbar.querySelector('#toolbox-collapse-all').addEventListener('click', () => {
        for (const w of body.querySelectorAll('.tool-group')) w.classList.add('collapsed');
        localStorage.setItem(collapsedKey, JSON.stringify([...body.querySelectorAll('.tool-group')].map(x => x.dataset.key)));
    });
    applyToolboxSearch();
    // 拖拽排序
    let dragKey = null;
    let suppressHeaderClick = 0;
    body.addEventListener('dragstart', (e) => {
        const header = e.target.closest('.tool-group-header');
        if (!header) return;
        dragKey = header.parentElement.dataset.key;
        e.dataTransfer.effectAllowed = 'move';
    });
    body.addEventListener('dragover', (e) => {
        e.preventDefault();
        const wrap = e.target.closest('.tool-group');
        if (!wrap || !dragKey) return;
        const list = [...body.querySelectorAll('.tool-group')];
        const from = list.findIndex(x => x.dataset.key === dragKey);
        const to = list.indexOf(wrap);
        if (from >= 0 && to >= 0 && from !== to) {
            if (from < to) body.insertBefore(list[from], list[to].nextSibling);
            else body.insertBefore(list[from], list[to]);
        }
    });
    body.addEventListener('drop', (e) => {
        e.preventDefault();
        dragKey = null;
        suppressHeaderClick = Date.now() + 250;
        const arr = [...body.querySelectorAll('.tool-group')].map(x => x.dataset.key);
        localStorage.setItem(orderKey, JSON.stringify(arr));
    });
}
initToolboxGroups();
const { window:W, server:S, terminal:T, settings:ST, app:A, update:U } = window.electronAPI||{};
// Toast 轻提示（替代部分 alert，套壳内展示）
function showToast(message, type = 'info', opts = {}) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const iconMap = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = iconMap[type] || iconMap.info;
    const msg = document.createElement('span');
    msg.className = 'toast-msg';
    msg.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(msg);
    if (opts && typeof opts === 'object' && opts.actionText && typeof opts.action === 'function') {
        const btn = document.createElement('button');
        btn.className = 'toast-action';
        btn.textContent = opts.actionText;
        btn.addEventListener('click', () => { try { opts.action(); } catch (_) {} dismiss(); });
        toast.appendChild(btn);
    }
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭提示');
    const dismiss = () => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 250);
    };
    close.addEventListener('click', dismiss);
    toast.appendChild(close);
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    const duration = (opts && typeof opts.duration === 'number') ? opts.duration : 3200;
    setTimeout(dismiss, duration);
}
function showConfirm({ title = '确认操作', message = '', confirmText = '确定', cancelText = '取消', danger = false } = {}) {
    return new Promise(resolve => {
        let overlay = document.getElementById('confirm-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'confirm-overlay';
            overlay.className = 'overlay confirm-overlay hidden';
            overlay.innerHTML = `<div class="confirm-panel" role="dialog" aria-modal="true" aria-label="确认操作">
                <div class="confirm-title"></div>
                <div class="confirm-message"></div>
                <div class="confirm-actions">
                    <button type="button" class="btn-secondary confirm-cancel"></button>
                    <button type="button" class="btn-primary confirm-ok"></button>
                </div>
            </div>`;
            document.body.appendChild(overlay);
        }
        const titleEl = overlay.querySelector('.confirm-title');
        const msgEl = overlay.querySelector('.confirm-message');
        const okBtn = overlay.querySelector('.confirm-ok');
        const cancelBtn = overlay.querySelector('.confirm-cancel');
        titleEl.textContent = title;
        msgEl.textContent = message;
        okBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;
        okBtn.className = 'btn-primary confirm-ok' + (danger ? ' btn-danger' : '');
        overlay.classList.remove('hidden');
        const done = (v) => {
            overlay.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(v);
        };
        const onOk = () => done(true);
        const onCancel = () => done(false);
        const onBackdrop = e => { if (e.target === overlay) done(false); };
        const onKey = e => {
            if (e.key === 'Escape') done(false);
            if (e.key === 'Enter' && e.target === okBtn) done(true);
            if (e.key === 'Tab') {
                const focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                if (!focusables.length) return;
                const list = [...focusables];
                const first = list[0], last = list[list.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        };
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        cancelBtn.focus();
    });
}

const $=s=>document.querySelector(s);
const webview=$('#sillytavern-webview'),loading=$('#loading-overlay'),loadingLog=$('#loading-log');
const termPanel=$('#terminal-panel'),termOut=$('#terminal-output'),termInput=$('#terminal-input');
const btnTerm=$('#btn-terminal'),btnSettings=$('#btn-settings'),settingsOverlay=$('#settings-overlay');

// ── basicAuth 登录弹窗（凭据只存套壳 settings，不写 ST 本体）──
const authEl = { overlay: $('#auth-overlay'), user: $('#auth-user'), pass: $('#auth-pass'), remember: $('#auth-remember'), login: $('#btn-auth-login'), cancel: $('#btn-auth-cancel'), cancel2: $('#btn-auth-cancel2') };
let authHost = '';
function showAuthPrompt(info = {}) {
    if (!authEl.overlay) return;
    authHost = String(info?.host || '');
    authEl.user.value = '';
    authEl.pass.value = '';
    authEl.remember.checked = false;
    (async () => {
        try {
            const s = await ST?.get?.() || {};
            if (s.stAuthUser || s.lanUser) authEl.user.value = s.stAuthUser || s.lanUser || '';
            if (s.stAuthPass || s.lanPass) authEl.pass.value = s.stAuthPass || s.lanPass || '';
            authEl.remember.checked = !!(s.stAuthUser && s.stAuthPass);
        } catch (_) {}
    })();
    authEl.overlay.classList.remove('hidden');
    setTimeout(() => authEl.user?.focus(), 80);
}
function hideAuthPrompt() { authEl.overlay?.classList.add('hidden'); }
async function respondAuth(payload) { hideAuthPrompt(); return await (window.electronAPI?.shellAuth?.respond?.(payload) || { ok: false }); }
authEl.login?.addEventListener('click', async () => {
    const user = authEl.user.value.trim();
    const pass = authEl.pass.value;
    if (!user) { authEl.user?.focus(); return; }
    if (authEl.remember.checked) { try { await ST?.save?.({ stAuthUser: user, stAuthPass: pass }); } catch (_) {} }
    const r = await respondAuth({ user, pass });
    if (!r?.ok) {
        // 当前没有待处理的认证请求（已经显示 Unauthorized 页）→ 存一次性凭据并重载 webview
        await window.electronAPI?.shellAuth?.retry?.({ user, pass });
        try { webview?.reload(); } catch (_) {}
    }
});
authEl.cancel?.addEventListener('click', () => respondAuth({ cancel: true }));
authEl.cancel2?.addEventListener('click', () => respondAuth({ cancel: true }));
authEl.pass?.addEventListener('keydown', e => { if (e.key === 'Enter') authEl.login?.click(); });
authEl.user?.addEventListener('keydown', e => { if (e.key === 'Enter') authEl.pass?.focus(); });
window.electronAPI?.shellAuth?.onRequired?.(showAuthPrompt);

// ── Window controls ──────────────────────────
$('#btn-minimize')?.addEventListener('click',()=>W?.minimize());
$('#btn-maximize')?.addEventListener('click',()=>W?.maximize());
$('#btn-close')?.addEventListener('click',()=>W?.close());
$('#titlebar')?.addEventListener('dblclick',e=>{if(!e.target.closest('.window-controls'))W?.maximize();});
const iconMax=$('#icon-maximize'),iconRestore=$('#icon-restore');
function setMaxState(v){if(iconMax)iconMax.style.display=v?'none':'';if(iconRestore)iconRestore.style.display=v?'':'';}
W?.isMaximized().then(setMaxState);W?.onMaximizeChange(setMaxState);

// ── Server → webview ─────────────────────────
let serverReady=false;
const titlebarStatus={box:$('#titlebar-status'),dot:$('#titlebar-dot'),text:$('#titlebar-status-text'),url:$('#titlebar-url')};
function setTitlebarStatus(state,text,url){
    if(titlebarStatus.dot)titlebarStatus.dot.className='titlebar-dot '+state;
    if(titlebarStatus.text)titlebarStatus.text.textContent=text||'';
    if(titlebarStatus.url){titlebarStatus.url.textContent=url||'';titlebarStatus.url.title=url||'';titlebarStatus.url.style.display=url?'':'none';}
}
titlebarStatus.box?.addEventListener('click',()=>toggleTerminal());
titlebarStatus.url?.addEventListener('click',async(e)=>{e.stopPropagation();const u=titlebarStatus.url.textContent||'';if(u){try{await navigator.clipboard.writeText(u);showToast('地址已复制','success');}catch(_){}}});
S?.onUrl(url=>{serverReady=true;if(webview&&url)webview.src=url;setTitlebarStatus('running','运行中',url);});
// Pull fallback: if the server printed its URL before this page registered
// its listener (fast-start server), the push event was lost — recover it.
(async()=>{const u=await S?.getUrl();if(u&&!serverReady){serverReady=true;if(webview)webview.src=u;setTitlebarStatus('running','运行中',u);}})();
S?.onError(msg=>{setTitlebarStatus('error','启动失败');if(loading){loading.classList.remove('hidden');const t=loading.querySelector('.loading-text');if(t)t.textContent='启动失败';if(loadingLog){loadingLog.textContent=msg;loadingLog.classList.add('show');}}});
S?.onSetupStarted?.(()=>{setTitlebarStatus('starting','首次安装中');const t=loading?.querySelector('.loading-text');if(t)t.textContent='首次启动 — 正在安装 SillyTavern...';if(loadingLog){loadingLog.classList.add('show');loadingLog.scrollTop=loadingLog.scrollHeight;}});
webview?.addEventListener('dom-ready', async () => {
    loading?.classList.add('hidden'); webview.classList.remove('hidden'); webview.focus();
    (async () => { try { const s = await window.electronAPI?.settings?.get?.() || {}; const v = s.stUiScale || 1; try { webview?.send('st-scale', v); } catch (_) {} } catch (_) {} })();
    // ST 开启 basicAuth 且认证失败时，页面可能已经渲染为 Unauthorized；主动检测并弹出登录框
    try {
        const text = await webview.executeJavaScript('document.body ? document.body.innerText : ""');
        if (String(text).includes('Unauthorized')) showAuthPrompt({ host: '127.0.0.1' });
    } catch (_) {}
});
// webview 右键（webview-preload 上报）→ 主进程弹菜单
webview?.addEventListener('ipc-message', (e) => {
    if (e.channel === 'ctxmenu') {
        const p = e.args?.[0] || {};
        A?.contextMenu?.({ kind: 'webview', x: p.x, y: p.y, hasSelection: p.hasSelection });
    } else if (e.channel === 'hotkey') {
        const k = String(e.args?.[0] || '').toUpperCase();
        if (k === 'T') $('#btn-tools')?.click();
        else if (k === 'R') webview?.reload();
        else if (k === 'L') openSettings();
    }
});
// 套壳界面右键（非 webview 区域）→ 主进程弹菜单
document.addEventListener('contextmenu', (e) => {
    if (e.target === document.body || e.target.closest?.('#titlebar') || e.target.closest?.('#float-buttons') || e.target.closest?.('.panel') || e.target.closest?.('.overlay')) {
        e.preventDefault();
        A?.contextMenu?.({ kind: 'shell' });
    }
});
// 主进程菜单命令执行
A?.onCtxCmd?.(cmd => {
    if (!webview) return;
    if (cmd === 'reload') webview.reload();
    else if (cmd === 'goBack') { if (webview.canGoBack?.()) webview.goBack(); }
    else if (cmd === 'goForward') { if (webview.canGoForward?.()) webview.goForward(); }
    else if (cmd === 'zoomIn') { zoomFactor = Math.min(ZOOM_MAX, zoomFactor + ZOOM_STEP); applyZoom(); }
    else if (cmd === 'zoomOut') { zoomFactor = Math.max(ZOOM_MIN, zoomFactor - ZOOM_STEP); applyZoom(); }
    else if (cmd === 'zoomReset') { zoomFactor = 1; applyZoom(); }
    else if (cmd === 'inspect') { try { webview.openDevTools(); } catch (_) {} }
});
A?.onShellAction?.(a => {
    if (a === 'settings') openSettings();
    else if (a === 'tools') { $('#btn-tools')?.click(); }
    else if (a === 'terminal') toggleTerminal();
    else if (a === 'update') { openSettings(); checkShellUpdate(); }
});
webview?.addEventListener('will-navigate',e=>{try{const cur=webview.getURL?.()||webview.src||'';if(!cur)return;if(new URL(e.url).origin!==new URL(cur).origin)e.preventDefault();}catch(_){}});
webview?.addEventListener('new-window',e=>{e.preventDefault();const u=String(e.url||'');if(/^https?:\/\//i.test(u))W?.openExternal(u);});

// ── Terminal ─────────────────────────────────
// Batched rendering: ST logs can flood — append via textContent nodes on a 60ms
// throttle instead of rebuilding innerHTML on every line (was O(n²) → freeze).
let termOpen=false,termHistory='',termBuf='',termTimer=null,termNodes=0,termAutoScroll=true;
const TERM_MAX_NODES=800,TERM_HISTORY_MAX=2*1024*1024;
function stripAnsi(t){return t.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g,'');}
function termAppend(text){
    if(!text)return;
    termHistory+=text;
    if(termHistory.length>TERM_HISTORY_MAX)termHistory=termHistory.slice(-TERM_HISTORY_MAX/2);
    if(!termOpen)return;
    termBuf+=text;
    if(termTimer)return;
    termTimer=setTimeout(flushTerm,60);
}
function flushTerm(){
    termTimer=null;
    if(!termBuf||!termOut)return;
    const div=document.createElement('div');
    div.textContent=stripAnsi(termBuf);
    termBuf='';
    termOut.appendChild(div);
    termNodes++;
    while(termNodes>TERM_MAX_NODES&&termOut.firstChild){termOut.firstChild.remove();termNodes--;}
    if(termAutoScroll)termOut.scrollTop=termOut.scrollHeight;
}
function toggleTerminal(){
    termOpen=!termOpen;
    termPanel.classList.toggle('hidden',!termOpen);
    btnTerm.classList.toggle('active',termOpen);
    const fb=$('#float-buttons');if(fb)fb.style.display=termOpen?'none':'';
    updateWebviewSize();
    if(termOpen){
        termInput?.focus();
        if(termOut) termOut.tabIndex = 0; // 让 Ctrl+C 复制选中日志的 keydown 能触发
        termOut.textContent='';termNodes=0;
        if(termHistory){const d=document.createElement('div');d.textContent=stripAnsi(termHistory);termOut.appendChild(d);termNodes=1;}
        if(termAutoScroll)termOut.scrollTop=termOut.scrollHeight;
    }
}
// Terminal height: mouse-resizable via the handle at the panel top, persisted per-session
const TERM_HEIGHT_MIN=120,TERM_HEIGHT_BASE_MAX=600;
// Dynamic ceiling: never squeeze the webview below 80px (titlebar 38 + panel bottom 12 + 80)
const termMaxHeight=()=>Math.min(TERM_HEIGHT_BASE_MAX,Math.max(TERM_HEIGHT_MIN,window.innerHeight-38-12-80));
let termHeight=(()=>{const v=parseInt(localStorage.getItem('termHeight')||'260',10);return Math.min(termMaxHeight(),Math.max(TERM_HEIGHT_MIN,v));})();
function updateWebviewSize(){
    if(!webview)return;
    termHeight=Math.min(termMaxHeight(),Math.max(TERM_HEIGHT_MIN,termHeight));
    if(termPanel)termPanel.style.height=termHeight+'px';
    const b=termOpen?termHeight+12:0;
    webview.style.bottom=b+'px';
    webview.style.height=`calc(100% - 38px - ${b}px)`;
}
// Window resize: re-clamp so the terminal never overflows the viewport
window.addEventListener('resize',updateWebviewSize);
(function initTermResize(){
    const handle=$('#term-resize-handle');if(!handle)return;
    let dragging=false,startY=0,startH=0;
    handle.addEventListener('mousedown',e=>{
        dragging=true;startY=e.screenY;startH=termHeight;
        termPanel.classList.add('resizing');
        e.preventDefault();
        document.body.style.cursor='ns-resize';
    });
    document.addEventListener('mousemove',e=>{
        if(!dragging)return;
        const dh=e.screenY-startY;
        // 面板 bottom 固定，手柄在顶部：向上拖(screenY 减小)应增高，所以用 startH - dh
        termHeight=Math.min(termMaxHeight(),Math.max(TERM_HEIGHT_MIN,startH-dh));
        updateWebviewSize();
    });
    document.addEventListener('mouseup',()=>{
        if(!dragging)return;
        dragging=false;
        termPanel.classList.remove('resizing');
        document.body.style.cursor='';
        try{localStorage.setItem('termHeight',String(termHeight));}catch(_){}
    });
})();
let loadBuf='',loadTimer=null;
function loadingAppend(text){
    if(!loadingLog)return;
    loadBuf+=text;
    loadingLog.classList.add('show');
    if(loadTimer)return;
    loadTimer=setTimeout(()=>{loadTimer=null;loadingLog.textContent+=stripAnsi(loadBuf);loadBuf='';loadingLog.scrollTop=loadingLog.scrollHeight;},80);
}

btnTerm?.addEventListener('click',toggleTerminal);
$('#btn-terminal-close')?.addEventListener('click',toggleTerminal);
$('#btn-terminal-copy')?.addEventListener('click',async()=>{const t=stripAnsi(termHistory)||termOut?.innerText||'';await navigator.clipboard.writeText(t);const b=$('#btn-terminal-copy');if(b){b.textContent='✅';setTimeout(()=>{b.textContent='📋';},1000);}});
$('#btn-terminal-export')?.addEventListener('click',async()=>{
    const r=await window.electronAPI?.terminal?.exportLog?.();
    if(r?.path) showToast('日志已导出到：' + r.path, 'success');
    else if(r?.error) showToast('导出失败：' + r.error, 'error');
});
$('#btn-terminal-clear')?.addEventListener('click',()=>{
    termHistory='';termBuf='';termTimer=null;
    if(termOut){termOut.textContent='';termNodes=0;}
    showToast('终端已清空','success');
});
$('#btn-terminal-autoscroll')?.addEventListener('click',()=>{
    termAutoScroll=!termAutoScroll;
    const b=$('#btn-terminal-autoscroll');
    if(b){b.classList.toggle('active',termAutoScroll);b.title=termAutoScroll?'自动滚动':'已暂停自动滚动';b.textContent=termAutoScroll?'📜':'⏸';}
    if(termAutoScroll&&termOut)termOut.scrollTop=termOut.scrollHeight;
});

termOut?.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='c'){const s=window.getSelection()?.toString();if(s){e.preventDefault();navigator.clipboard.writeText(s);}}});
let termHistoryList = [], termHistIdx = -1;
termInput?.addEventListener('keydown', async e => {
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (termHistoryList.length) {
            if (termHistIdx === -1) termHistIdx = termHistoryList.length - 1;
            else if (termHistIdx > 0) termHistIdx--;
            termInput.value = termHistoryList[termHistIdx];
        }
        return;
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (termHistIdx !== -1) {
            termHistIdx++;
            if (termHistIdx >= termHistoryList.length) { termHistIdx = -1; termInput.value = ''; }
            else termInput.value = termHistoryList[termHistIdx];
        }
        return;
    }
    if (e.key !== 'Enter' || !termInput.value.trim()) return;
    const cmd = termInput.value.trim();
    termInput.value = ''; termHistIdx = -1;
    termInput.disabled = true; termAppend(`> ${cmd}\n`);
    if (termHistoryList[termHistoryList.length - 1] !== cmd) termHistoryList.push(cmd);
    try { const r = await T?.exec(cmd); if (r.stdout) termAppend(r.stdout); if (r.stderr) termAppend(r.stderr); if (r.error) termAppend(`Error: ${r.error}\n`); } catch (err) { termAppend(`${err.message}\n`); }
    termInput.disabled = false; termInput.focus();
});

T?.onOutput(text=>{if(!serverReady&&loadingLog)loadingAppend(text);termAppend(text);});
(async()=>{const h=await T?.getHistory();if(h){termHistory=h;if(!serverReady&&loadingLog){loadingLog.classList.add('show');loadingLog.textContent=stripAnsi(h);loadingLog.scrollTop=loadingLog.scrollHeight;}}})();

// ── Settings ─────────────────────────────────
let settingsData={};
let settingsTabsData=null;
// 设置页 Tab：按现有 DOM 结构分组，不依赖额外 HTML 标记
function initSettingsTabs() {
    const tabs = document.querySelectorAll('#settings-tabs .settings-tab');
    if (!tabs.length) return;
    const body = document.querySelector('.settings-content') || document.querySelector('.settings-body');
    if (!body) return;
    const searchWrap = body.querySelector('.settings-search-wrap');
    const children = [...body.children].filter(el => el !== searchWrap && el.id !== 'settings-tabs');
    const firstSectionIdx = children.findIndex(el => el.classList.contains('update-section'));
    const generalEls = firstSectionIdx >= 0 ? children.slice(0, firstSectionIdx) : children;
    const sections = children.filter(el => el.classList.contains('update-section') && el.children.length > 0);
    const groups = {
        general: generalEls,
        tools: [sections[0]],
        server: [sections[1]],
        update: [sections[2], sections[3]],
        integrity: [sections[4]],
    };
    function switchSettingsTab(name) {
        const show = groups[name] || [];
        for (const el of children) el.style.display = 'none';
        if (searchWrap) searchWrap.style.display = '';
        for (const el of show) if (el) el.style.display = '';
        for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tab === name);
        try { localStorage.setItem('settingsTab', name); } catch (_) {}
    }
    settingsTabsData = { children, groups, switchSettingsTab, searchWrap };
    for (const tab of tabs) tab.addEventListener('click', () => switchSettingsTab(tab.dataset.tab));
    switchSettingsTab(localStorage.getItem('settingsTab') || 'general');
}
function applySettingsSearch() {
    const input = document.getElementById('settings-search');
    if (!settingsTabsData || !input) return;
    const clear = document.getElementById('settings-search-clear');
    const query = input.value.trim().toLowerCase();
    if (clear) clear.classList.toggle('hidden', !query);
    if (!query) { for (const el of settingsTabsData.children) { el.classList.remove('search-hit-row'); el.querySelectorAll('.setting-row').forEach(row => row.classList.remove('search-hit-row')); } settingsTabsData.switchSettingsTab(localStorage.getItem('settingsTab') || 'general'); return; }
    for (const el of settingsTabsData.children) {
        const text = (el.textContent || '').toLowerCase();
        const match = text.includes(query);
        el.style.display = match ? '' : 'none';
        el.classList.toggle('search-hit-row', match);
        el.querySelectorAll('.setting-row').forEach(row => {
            const rtext = (row.textContent || '').toLowerCase();
            row.classList.toggle('search-hit-row', rtext.includes(query));
        });
    }
}
document.getElementById('settings-search')?.addEventListener('input', applySettingsSearch);
document.getElementById('settings-search-clear')?.addEventListener('click', () => {
    const input = document.getElementById('settings-search');
    if (input) { input.value = ''; input.focus(); }
    applySettingsSearch();
});
initSettingsTabs();
applySettingsSearch();
function normalizeSettingRows() {
    document.querySelectorAll('.settings-content .setting-row').forEach(row => {
        if (row.dataset.normalized) return;
        const label = row.querySelector(':scope > label:not(.tool-switch)');
        const notes = [...row.querySelectorAll(':scope > .tool-note')];
        const controls = [...row.children].filter(el => el !== label && !notes.includes(el));
        if (!controls.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'setting-controls';
        controls.forEach(el => wrap.appendChild(el));
        row.insertBefore(wrap, notes[0] || null);
        notes.forEach(n => n.classList.add('setting-hint'));
        row.dataset.normalized = '1';
    });
}
normalizeSettingRows();
async function openSettings(){settingsOverlay.classList.remove('hidden');setSettingsDirty(false);settingsData=(await ST?.get())||{};const v=await A?.getVersion();$('#setting-server-path').value=settingsData.serverPath||'';$('#setting-data-root').value=(await ST?.getDataRoot())||'';$('#setting-width').value=settingsData.windowWidth||1280;$('#setting-height').value=settingsData.windowHeight||800;const cs=$('#setting-close-behavior');if(cs)cs.value=settingsData.closeBehavior||'ask';if($('#version-display'))$('#version-display').textContent=v||'unknown';if($('#shell-version-display'))$('#shell-version-display').textContent='v'+(await A?.getShellVersion()||'?');const sc=$('#server-ctl-status');if(sc)sc.textContent=sc.className='';const s=$('#update-status');if(s)s.textContent=s.className='';$('#btn-do-update')?.remove();$('#btn-view-update')?.remove();const p=$('#update-progress');if(p)p.classList.add('hidden');const ss=$('#shell-update-status');if(ss)ss.textContent=ss.className='';$('#btn-dl-shell')?.remove();checkShellUpdate();if(typeof renderTools==='function')renderTools();if(typeof renderUiSettings==='function')renderUiSettings();}
function closeSettings(){settingsOverlay.classList.add('hidden');}
btnSettings?.addEventListener('click',openSettings);
$('#btn-settings-close')?.addEventListener('click',confirmCloseSettings);
$('#btn-settings-cancel')?.addEventListener('click',confirmCloseSettings);
settingsOverlay?.addEventListener('click',e=>{if(e.target===settingsOverlay)confirmCloseSettings();});
$('#btn-settings-save')?.addEventListener('click',async()=>{const sp=$('#setting-server-path').value.trim();const w=parseInt($('#setting-width').value)||1280;const h=parseInt($('#setting-height').value)||800;const cb=$('#setting-close-behavior')?.value||'ask';const pathChanged=sp!==(settingsData.serverPath||'');const r=await ST?.save({serverPath:sp,windowWidth:w,windowHeight:h,closeBehavior:cb});if(r?.error){showToast('保存失败：' + r.error, 'error');return;}setSettingsDirty(false);closeSettings();if(pathChanged){showToast('服务器路径已保存，重启套壳后生效。', 'success');}});
document.getElementById('setting-server-path-browse')?.addEventListener('click', async () => {
    const r = await window.electronAPI?.window?.pickDirectory?.();
    if (r?.path) $('#setting-server-path').value = r.path;
});
document.getElementById('t-backup-dir-browse')?.addEventListener('click', async () => {
    const r = await window.electronAPI?.window?.pickDirectory?.();
    if (r?.path) {
        $('#t-backup-dir').value = r.path;
        await TL()?.backupSave({ dir: r.path });
        setNote(tEl.backupInfo, '已保存目标目录');
    }
});

// ── Server controls ─────────────────────────
$('#btn-restart-server')?.addEventListener('click',async()=>{const b=$('#btn-restart-server'),sc=$('#server-ctl-status');if(b)b.disabled=true;if(sc){sc.textContent='正在重启服务器...';sc.className='update-status info';}const r=await window.electronAPI?.server?.restart();if(sc){if(r?.success){sc.textContent='✅ 服务器已重启';sc.className='update-status success';}else{sc.textContent='重启失败: '+(r?.error||'unknown');sc.className='update-status error';}}if(b)b.disabled=false;});
$('#btn-open-st-dir')?.addEventListener('click',async()=>{const p=await ST?.getServerPath();if(p)window.electronAPI?.window?.openPath(p);});
$('#btn-open-data-dir')?.addEventListener('click',async()=>{const p=await ST?.getDataRoot();if(p)window.electronAPI?.window?.openPath(p);});
$('#btn-shell-changelog')?.addEventListener('click',async()=>{const md=await A?.getChangelog();const html=md.replace(/^# (.+)/gm,'<h3>$1</h3>').replace(/^## (.+)/gm,'<h4>$1</h4>').replace(/^- (.+)/gm,'<li>$1</li>').replace(/(<li>.*<\/li>)/gs,'<ul>$1</ul>');const el=document.createElement('div');el.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:999;display:flex;align-items:center;justify-content:center';el.innerHTML=`<div style=\"background:rgba(18,18,42,0.95);backdrop-filter:blur(20px);border-radius:12px;padding:20px;max-width:500px;max-height:80vh;overflow-y:auto;color:#c8c8d4;font-size:13px;line-height:1.6\"><div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:12px\"><h3 style=\"margin:0;color:#7c5cbf\">套壳更新日志</h3><button style=\"background:none;border:none;color:#c8c8d4;font-size:18px;cursor:pointer\">&times;</button></div>${html}</div>`;el.querySelector('button').onclick=()=>el.remove();el.onclick=e=>{if(e.target===el)el.remove();};document.body.appendChild(el);});

// ── Update ───────────────────────────────────
let updateData=null,updateCleanup=null;
$('#btn-check-update')?.addEventListener('click',checkUpdate);

async function checkUpdate(){const b=$('#btn-check-update'),s=$('#update-status');if(b)b.disabled=true;if(s){s.textContent='检查中...';s.className='update-status info';}updateData=await U?.check();if(updateData?.error){if(s){s.textContent='检查失败: '+updateData.error;s.className='update-status error';}}else if(updateData?.hasUpdate){if(s){s.innerHTML=`发现新版本 <b>v${escapeHtml(updateData.latest)}</b> (当前 v${escapeHtml(updateData.current)})`;s.className='update-status success';}let ub=$('#btn-do-update');if(!ub){ub=document.createElement('button');ub.id='btn-do-update';ub.className='btn-primary';ub.textContent='立即更新';ub.addEventListener('click',doUpdate);$('#update-section-st')?.appendChild(ub);}let vu=$('#btn-view-update');if(!vu&&updateData?.url){vu=document.createElement('button');vu.id='btn-view-update';vu.className='btn-secondary';vu.textContent='查看更新日志';vu.style.marginTop='6px';vu.addEventListener('click',()=>{window.electronAPI?.window?.openExternal?.(updateData.url);});$('#update-section-st')?.appendChild(vu);}}else{if(s){s.textContent='已是最新版本 (v'+updateData.current+')';s.className='update-status info';}}if(b)b.disabled=false;}
async function doUpdate(){const s=$('#update-status'),p=$('#update-progress');$('#btn-do-update').disabled=true;$('#btn-check-update').disabled=true;s.textContent='更新中 (git pull + npm install)...';s.className='update-status info';p.classList.remove('hidden');$('#progress-fill').style.width='100%';$('#progress-text').textContent='更新完成后服务器将自动重启';try{const r=await U?.updateSillyTavern();if(r?.success){s.textContent='更新完成！';s.className='update-status success';p.classList.add('hidden');}else throw new Error(r?.error||'Update failed');}catch(e){s.textContent='更新失败: '+e.message;s.className='update-status error';p.classList.add('hidden');}}

document.addEventListener('keydown',e=>{
    if(e.ctrlKey&&e.key==='`'){e.preventDefault();toggleTerminal();return;}
    if(e.ctrlKey&&e.key==='0'){e.preventDefault();zoomFactor=1;applyZoom();return;}
    if(e.ctrlKey&&(e.key==='='||e.key==='+'||e.key==='-')){e.preventDefault();zoomFactor=Math.min(ZOOM_MAX,Math.max(ZOOM_MIN,zoomFactor+(e.key==='-'?-ZOOM_STEP:ZOOM_STEP)));applyZoom();}
});
$('#btn-refresh')?.addEventListener('click',()=>{webview?.reload();});
$('#btn-toggle-fabs')?.addEventListener('click',()=>{$('#float-buttons').classList.toggle('collapsed');});

// ── Zoom (viewport-level, browser-like) ──────
// Ctrl+wheel reported by webview-preload.js → webview.setZoomFactor()
// (real viewport zoom with layout reflow, unlike body.style.zoom).
let zoomFactor=1;
const ZOOM_MIN=0.5,ZOOM_MAX=3,ZOOM_STEP=0.1;
function applyZoom(){try{webview?.setZoomFactor(zoomFactor);}catch(_){}showZoomHint();}
function showZoomHint(){
    let b=$('#zoom-badge');
    if(!b){b=document.createElement('div');b.id='zoom-badge';document.body.appendChild(b);}
    b.textContent=Math.round(zoomFactor*100)+'%';
    b.classList.add('show');
    clearTimeout(showZoomHint._t);
    showZoomHint._t=setTimeout(()=>b.classList.remove('show'),900);
}
webview?.addEventListener('ipc-message',e=>{
    if(e.channel==='zoom-wheel'&&typeof e.args?.[0]==='number'){
        const dir=e.args[0];
        zoomFactor=Math.min(ZOOM_MAX,Math.max(ZOOM_MIN,zoomFactor+dir*ZOOM_STEP));
        applyZoom();
    }
});

// Integrity check
$('#btn-check-integrity')?.addEventListener('click',async()=>{const s=$('#integrity-status');if(!s)return;s.textContent='检测中...';s.className='update-status info';try{const data=await (window.electronAPI?.tools?.integrityCheck?.()||{});if(data?.error){s.textContent='检测失败: '+data.error;s.className='update-status error';return;}if(!data.out||data.out.length===0){s.textContent=data.git?'✅ 所有文件完整 (git 安装)':'✅ 核心文件完整 (非 git 安装)';s.className='update-status success';}else{s.innerHTML='<pre style=margin:0;font-size:11px;line-height:1.6;max-height:200px;overflow-y:auto>缺失文件：\n'+escapeHtml(data.out.join('\n'))+'</pre>';s.className='update-status error';}}catch(e){s.textContent='检测失败: '+e.message;s.className='update-status error';}});






// Ctrl+Scroll zoom — now handled via webview preload + setZoomFactor (see Zoom section above)

// ── 对话统计（自动记录，顶替原测速面板）──────────────────────────
function fmtNum(n) { return (n ?? 0).toLocaleString('en-US'); }

// ── Tools 工具箱 ─────────────────────────────────────────────────
const TL = () => window.electronAPI?.tools;
const tEl = {
    panel: $('#tools-panel'), btn: $('#btn-tools'), close: $('#btn-tools-close'),
    backupDir: $('#t-backup-dir'), backupAuto: $('#t-backup-auto'), backupInterval: $('#t-backup-interval'), backupKeep: $('#t-backup-keep'),
    backupNow: $('#t-backup-now'), backupNowRes: $('#t-backup-now-res'), backupInfo: $('#t-backup-info'),
    searchKw: $('#t-search-kw'), searchRes: $('#t-search-res'),
    stats: $('#t-stats'), statsRes: $('#t-stats-res'),
    exportCards: $('#t-export-cards'), summarize: $('#t-summarize'), portable: $('#t-portable'), exportRes: $('#t-export-res'),
    env: $('#t-env'), ollama: $('#t-ollama'), gpu: $('#t-gpu'), clash: $('#t-clash'), envRes: $('#t-env-res'),
    draftPrompt: $('#t-draft-prompt'), draft: $('#t-draft'), draftCopy: $('#t-draft-copy'), draftRes: $('#t-draft-res'),
    chat: $('#t-chat'),
    autostart: $('#t-autostart'), night: $('#t-night'), pin: $('#t-pin'), pinSet: $('#t-pin-set'),
    immerse: $('#t-immerse'), notify: $('#t-notify'), rollbackInfo: $('#t-rollback-info'), rollbackList: $('#t-rollback-list'),
};
function setNote(el, text) { if (el) el.textContent = text; }
// XSS 安全：所有动态内容一律转义为纯文本（\n → <br>），绝不直接 innerHTML 数据
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function setDetail(el, text) { if (el) el.innerHTML = escapeHtml(text).replace(/\n/g, '<br>'); }
// 仅用于可信 HTML（固定按钮/结构）。动态数据必须先 escapeHtml 再拼入。
function setDetailHtml(el, html) { if (el) el.innerHTML = html; }
async function renderTools() {
    if (!TL()) return;
    // 备份配置
    const bc = await TL().backupConfig();
    if (bc) {
        tEl.backupDir.value = bc.dir || '';
        tEl.backupAuto.checked = !!bc.auto;
        tEl.backupInterval.value = String(bc.intervalH || 24);
        tEl.backupKeep.value = bc.keep || 5;
        const list = await TL().backupList();
        setNote(tEl.backupInfo, list.length ? `已有 ${list.length} 份备份` : '');
        const sel = document.getElementById('t-backup-select');
        if (sel) {
            sel.innerHTML = '<option value="">选择备份…</option>' + list.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
        }
    }
    // 设置项
    tEl.autostart.value = (await TL().autostartGet()) ? '1' : '0';
    const ng = await TL().nightGet();
    if (ng) tEl.night.value = ng.enabled ? '1' : '0';
    const pg = await TL().pinGet();
    if (pg) setNote($('#t-pin-status'), pg.hasPin ? '已设置' : '');
    const s = await window.electronAPI?.settings?.get?.();
    if (s) tEl.notify.value = s.notifyGenerated === false ? '0' : '1';
    // 回滚列表
    const rl = await TL().rollbackList();
    setNote(tEl.rollbackInfo, rl.length ? `可用 ${rl.length} 个回滚包` : '无回滚包');
    setDetailHtml(tEl.rollbackList, rl.length ? rl.map(r => `<button class="btn-secondary" style="padding:2px 8px;font-size:11px;margin:2px" data-rollback="${escapeHtml(r.version)}">回滚到 v${escapeHtml(r.version)}</button>`).join('') : '');
    tEl.rollbackList.querySelectorAll('[data-rollback]').forEach(b => b.addEventListener('click', async () => {
        const ok = await showConfirm({ title: '版本回滚', message: `确定回滚到 v${b.dataset.rollback}？应用将退出并安装旧版。`, confirmText: '回滚', danger: true });
        if (ok) {
            await TL().rollbackInstall(b.dataset.rollback);
        }
    }));
}
// ── 迷你状态窗（可隐藏：设置/×按钮/托盘三处联动）──────────────────
const miniEl = { box: $('#mini-status'), dot: $('#mini-dot'), text: $('#mini-text'), close: $('#mini-close') };
let miniVisible = true, miniHideTs = 0;
let miniDismissed = false; // 用户点 × 后，本次运行内不再自动显示
function miniShow() {
    if (!miniEl.box) return;
    miniVisible = true;
    miniEl.box.classList.remove('hidden');
}
function miniHide() {
    if (!miniEl.box) return;
    miniVisible = false;
    miniEl.box.classList.add('hidden');
}
TL()?.onMini?.(v => {
    if (!v) return;
    if (!miniEl.dot || !miniEl.text) return;
    if (miniDismissed || document.body.dataset.miniEnabled === '0') return;
    miniEl.dot.className = 'mini-dot ' + v.state;
    if (v.state === 'gen') { clearTimeout(miniHideTs); miniEl.text.textContent = `🟡 ${v.char || '角色'} 生成中…`; }
    else if (v.state === 'done') {
        const t = v.ms != null && v.ms > 0 ? ` ${Math.round(v.ms / 1000)}s` : '';
        miniEl.text.textContent = `✓ ${v.char || '角色'} 回复完成${t}${v.toks ? ` · ${v.toks} tok` : ''}`;
    } else miniEl.text.textContent = v.char || '';
    miniShow();
    // 完成状态 8 秒后淡出回空闲
    if (v.state === 'done') {
        clearTimeout(miniHideTs);
        miniHideTs = setTimeout(() => { if (miniVisible && miniEl.text) miniEl.text.textContent = (v.char || '') + ' · 空闲'; miniEl.dot.className = 'mini-dot idle'; }, 8000);
    }
});
miniEl.close?.addEventListener('click', () => { if (miniDragIgnoreClick) return; miniDismissed = true; miniHide(); }); // 点 × 后本次运行内不再自动显示

// 迷你窗拖动（× 除外），位置持久化
let miniDrag = null, miniDragIgnoreClick = false;
miniEl.box?.addEventListener('pointerdown', e => {
    if (e.target === miniEl.close || e.button !== 0) return;
    const r = miniEl.box.getBoundingClientRect();
    miniDrag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
    e.preventDefault();
    try { miniEl.box.setPointerCapture?.(e.pointerId); } catch (_) {}
});
miniEl.box?.addEventListener('pointermove', e => {
    if (!miniDrag || !miniEl.box) return;
    const nx = miniDrag.ox + (e.clientX - miniDrag.sx);
    const ny = miniDrag.oy + (e.clientY - miniDrag.sy);
    miniEl.box.style.left = Math.max(4, Math.min(window.innerWidth - miniEl.box.offsetWidth - 4, nx)) + 'px';
    miniEl.box.style.top = Math.max(42, Math.min(window.innerHeight - miniEl.box.offsetHeight - 4, ny)) + 'px';
    miniEl.box.style.right = 'auto';
});
miniEl.box?.addEventListener('pointerup', () => {
    if (!miniDrag || !miniEl.box) return;
    if (miniEl.box.style.left) {
        localStorage.setItem('miniPos', JSON.stringify({ left: miniEl.box.style.left, top: miniEl.box.style.top }));
    }
    miniDrag = null; miniDragIgnoreClick = true; setTimeout(() => { miniDragIgnoreClick = false; }, 120);
});
miniEl.box?.addEventListener('pointercancel', () => { miniDrag = null; });
try {
    const p = JSON.parse(localStorage.getItem('miniPos') || 'null');
    if (p && p.left && miniEl.box) { miniEl.box.style.left = p.left; miniEl.box.style.top = p.top; miniEl.box.style.right = 'auto'; }
} catch (_) {}

// ── 设置项绑定（局域网/置顶/主题/字体/迷你窗/zip/崩溃提醒）─────────
function applyTheme(theme) {
    let resolved = theme || 'purple';
    if (resolved === 'system') {
        resolved = window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'purple';
    }
    document.body.dataset.theme = resolved;
    document.body.dataset.themePref = resolved === 'light' || resolved === 'purple' || resolved === 'blue' || resolved === 'black' ? resolved : theme;
}
try {
    window.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener?.('change', () => {
        const sel = document.getElementById('t-theme');
        if (sel && sel.value === 'system') applyTheme('system');
    });
} catch (_) {}
function applyUiLayoutPrefs() {
    const density = localStorage.getItem('uiDensity') || 'normal';
    const settingsWidth = localStorage.getItem('settingsPanelWidth') || 'medium';
    const toolsWidth = localStorage.getItem('toolsPanelWidth') || 'medium';
    document.body.dataset.uiDensity = density;
    document.body.dataset.settingsWidth = settingsWidth;
    document.body.dataset.toolsWidth = toolsWidth;
    const d = document.getElementById('t-ui-density');
    const sw = document.getElementById('t-settings-width');
    const tw = document.getElementById('t-tools-width');
    if (d) d.value = density;
    if (sw) sw.value = settingsWidth;
    if (tw) tw.value = toolsWidth;
}
applyUiLayoutPrefs();
document.getElementById('t-ui-density')?.addEventListener('change', (e) => {
    localStorage.setItem('uiDensity', e.target.value);
    applyUiLayoutPrefs();
    showToast('界面密度已更新', 'success');
});
document.getElementById('t-settings-width')?.addEventListener('change', (e) => {
    localStorage.setItem('settingsPanelWidth', e.target.value);
    applyUiLayoutPrefs();
    showToast('设置面板宽度已更新', 'success');
});
document.getElementById('t-tools-width')?.addEventListener('change', (e) => {
    localStorage.setItem('toolsPanelWidth', e.target.value);
    applyUiLayoutPrefs();
    showToast('工具箱宽度已更新', 'success');
});
// —— 强调色 ——
const accentInput = document.getElementById('t-accent');
function applyAccent() {
    const a = localStorage.getItem('uiAccent') || '#7c5cbf';
    document.body.style.setProperty('--accent', a);
    if (accentInput) accentInput.value = a;
}
applyAccent();
accentInput?.addEventListener('input', (e) => {
    localStorage.setItem('uiAccent', e.target.value);
    applyAccent();
    showToast('强调色已更新', 'success');
});

// —— ST 界面缩放（补偿 ST 基础字号，匹配外部壳比例）——
const stScaleInput = document.getElementById('t-st-scale');
async function applyStScale() {
    let v = parseFloat(stScaleInput?.value);
    if (!(v >= 0.8 && v <= 2)) v = 1;
    if (stScaleInput) stScaleInput.value = v;
    try { await window.electronAPI?.settings?.save?.({ stUiScale: v }); } catch (_) {}
    try { webview?.send('st-scale', v); } catch (_) {}
}
stScaleInput?.addEventListener('change', () => applyStScale());

// —— 设置未保存状态 ——
let settingsDirty = false;
function setSettingsDirty(v) {
    settingsDirty = v;
    const ind = document.getElementById('settings-dirty-indicator');
    const save = document.getElementById('btn-settings-save');
    if (ind) ind.classList.toggle('hidden', !v);
    if (save) save.classList.toggle('has-changes', v);
}
const settingsContentEl = document.querySelector('#settings-overlay .settings-content');
settingsContentEl?.addEventListener('input', () => setSettingsDirty(true));
settingsContentEl?.addEventListener('change', () => setSettingsDirty(true));

// —— 设置导出 / 导入 / 恢复默认 ——
async function exportSettings() {
    const s = await window.electronAPI?.settings?.get?.() || {};
    const ui = {
        density: localStorage.getItem('uiDensity') || 'normal',
        settingsWidth: localStorage.getItem('settingsPanelWidth') || 'medium',
        toolsWidth: localStorage.getItem('toolsPanelWidth') || 'medium',
        accent: localStorage.getItem('uiAccent') || '#7c5cbf',
        fontScale: localStorage.getItem('uiFontScale') || '',
    };
    const data = { version: 1, settings: s, ui, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sillytavern-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast('设置已导出', 'success');
}
async function importSettingsFile(file) {
    try {
        const data = JSON.parse(await file.text());
        if (data.settings) await window.electronAPI?.settings?.save?.(data.settings);
        if (data.ui) {
            if (data.ui.density) localStorage.setItem('uiDensity', data.ui.density);
            if (data.ui.settingsWidth) localStorage.setItem('settingsPanelWidth', data.ui.settingsWidth);
            if (data.ui.toolsWidth) localStorage.setItem('toolsPanelWidth', data.ui.toolsWidth);
            if (data.ui.accent) localStorage.setItem('uiAccent', data.ui.accent);
            if (data.ui.fontScale) localStorage.setItem('uiFontScale', data.ui.fontScale);
        }
        applyUiLayoutPrefs();
        applyAccent();
        if (typeof renderUiSettings === 'function') renderUiSettings().catch(() => {});
        setSettingsDirty(false);
        showToast('设置已导入', 'success');
    } catch (e) {
        showToast('导入失败: ' + e.message, 'error');
    }
}
document.getElementById('btn-export-settings')?.addEventListener('click', exportSettings);
document.getElementById('btn-import-settings')?.addEventListener('click', () => document.getElementById('import-settings-file')?.click());
document.getElementById('import-settings-file')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) await importSettingsFile(f);
    e.target.value = '';
});
document.getElementById('btn-reset-settings')?.addEventListener('click', async () => {
    const ok = await showConfirm({ title: '恢复默认设置', message: '将恢复套壳设置为默认值（服务器路径、窗口、UI 比例等）。确定继续？', confirmText: '恢复默认', danger: true });
    if (!ok) return;
    await window.electronAPI?.settings?.save?.({ serverPath: '', windowWidth: 1280, windowHeight: 800, closeBehavior: 'ask' });
    localStorage.removeItem('uiDensity'); localStorage.removeItem('settingsPanelWidth'); localStorage.removeItem('toolsPanelWidth'); localStorage.removeItem('uiAccent'); localStorage.removeItem('uiFontScale');
    applyUiLayoutPrefs(); applyAccent();
    if (typeof renderUiSettings === 'function') renderUiSettings().catch(() => {});
    setSettingsDirty(false);
    showToast('已恢复默认设置', 'success');
});

// —— 取消 / 关闭时若有未保存修改则确认 ——
async function confirmCloseSettings() {
    if (settingsDirty) {
        const ok = await showConfirm({ title: '放弃修改?', message: '有未保存的修改，确定放弃吗？', confirmText: '放弃', danger: true });
        if (!ok) return;
    }
    closeSettings();
}

// —— 快捷键帮助 ——
document.addEventListener('keydown', (e) => {
    if (e.key === '?' ) {
        e.preventDefault();
        showConfirm({ title: '快捷键', message: 'Ctrl+`  打开/关闭终端\nCtrl+Shift+T  工具箱\nCtrl+Shift+R  刷新页面\nCtrl+Shift+L  打开设置\nCtrl+0  缩放归位\nCtrl+= / Ctrl+-  缩放\nF11  沉浸模式\n?  显示本帮助', confirmText: '知道了', cancelText: '关闭' });
    }
});



async function renderUiSettings() {
    const u = await TL()?.uiGet();
    if (u) {
        $('#t-top').value = u.alwaysOnTop ? '1' : '0';
        $('#t-theme').value = u.theme || 'purple';
        $('#t-font').value = String(u.fontScale || 1);
        $('#t-mini').value = u.miniStatus ? '1' : '0';
        document.body.dataset.miniEnabled = u.miniStatus ? '1' : '0';
        if (u.miniStatus) miniDismissed = false; // 重新开启后恢复自动显示
        applyTheme(u.theme || 'purple');
        document.body.dataset.font = String(u.fontScale || 1);
        // 迷你窗：启动即显示空闲状态（清除 v1.8.8 及以前 × 按钮的 localStorage 残留）
        localStorage.removeItem('miniHidden');
        if (u.miniStatus) {
            if (miniEl.dot) miniEl.dot.className = 'mini-dot idle';
            if (miniEl.text) miniEl.text.textContent = '就绪';
            miniShow();
        } else {
            miniHide();
        }
    }
    const lc = await TL()?.lanConfig();
    if (lc) {
        $('#t-lan').value = lc.enabled ? '1' : '0';
        $('#t-lan-user').value = lc.user || '';
        $('#t-lan-pass').value = lc.pass || '';
        const ips = await TL()?.lanIps() || [];
        $('#t-lan-ips').textContent = lc.enabled && ips.length ? `手机访问: http://${ips[0]}:8000` : '';
    }
    const bc = await TL()?.backupConfig();
    if (bc) $('#t-backup-zip').value = bc.zip ? '1' : '0';
    const s = await window.electronAPI?.settings?.get?.() || {};
    $('#t-crash').value = s.crashAlert === false ? '0' : '1';
    if ($('#shell-channel')) $('#shell-channel').value = s.shellChannel === 'lite' ? 'lite' : 'full';
    if ($('#t-st-scale')) $('#t-st-scale').value = s.stUiScale || 1;
}
$('#t-lan')?.addEventListener('change', async () => {
    await TL()?.lanSave({ enabled: $('#t-lan').value === '1' });
    showToast('局域网访问已' + ($('#t-lan').value === '1' ? '开启' : '关闭') + '，重启服务器后生效（设置→服务器控制→重启服务器）', 'info');
    await renderUiSettings();
});
$('#t-lan-user')?.addEventListener('change', async () => { await TL()?.lanSave({ user: $('#t-lan-user').value.trim() }); });
$('#t-lan-pass')?.addEventListener('change', async () => { await TL()?.lanSave({ pass: $('#t-lan-pass').value }); });
// 输入即自动保存（防抖），避免失焦未触发导致“保存不了”
let lanSaveTimer = null;
$('#t-lan-user')?.addEventListener('input', () => { clearTimeout(lanSaveTimer); lanSaveTimer = setTimeout(() => TL()?.lanSave({ user: $('#t-lan-user').value.trim() }), 400); });
$('#shell-channel')?.addEventListener('change', async () => {
    const v = $('#shell-channel').value === 'lite' ? 'lite' : 'full';
    await window.electronAPI?.settings?.save?.({ shellChannel: v });
    showToast('套壳更新版本已切换为' + (v === 'lite' ? '轻量版' : '完整版') + '，下次检查更新时生效', 'success');
document.getElementById('t-lan-qr')?.addEventListener('click', async () => {
    const ips = await TL()?.lanIps?.() || [];
    if (!ips.length) { setNote($('#t-lan-ips'), '未获取到局域网 IP'); return; }
    const url = 'http://' + ips[0] + ':8000';
    const r = await window.electronAPI?.tools?.qrcode?.(url);
    const area = document.getElementById('t-qr-area');
    const img = document.getElementById('t-qr-img');
    if (r?.url && area && img) { img.src = r.url; area.style.display = ''; setNote($('#t-lan-ips'), '手机扫码访问: ' + url); }
    else if (area) { area.style.display = 'none'; setNote($('#t-lan-ips'), '二维码生成失败'); }
});
});
$('#t-lan-pass')?.addEventListener('input', () => { clearTimeout(lanSaveTimer); lanSaveTimer = setTimeout(() => TL()?.lanSave({ pass: $('#t-lan-pass').value }), 400); });
$('#t-top')?.addEventListener('change', async () => { await TL()?.uiSet('alwaysOnTop', $('#t-top').value === '1'); });
$('#t-theme')?.addEventListener('change', async () => { const v = $('#t-theme').value; await TL()?.uiSet('theme', v); applyTheme(v); });
$('#t-font')?.addEventListener('change', async () => { const v = $('#t-font').value; await TL()?.uiSet('fontScale', Number(v)); document.body.dataset.font = v; });
$('#t-mini')?.addEventListener('change', async () => {
    const on = $('#t-mini').value === '1';
    await TL()?.uiSet('miniStatus', on);
    if (on) miniShow(); else miniHide();
});
$('#t-backup-zip')?.addEventListener('change', async () => { await TL()?.backupSave({ zip: $('#t-backup-zip').value === '1' }); });
$('#t-crash')?.addEventListener('change', async () => {
    const s = await window.electronAPI?.settings?.get?.() || {};
    s.crashAlert = $('#t-crash').value === '1';
    await window.electronAPI?.settings?.save?.(s);
});

// ── B13 异常退出提示 ─────────────────────────────────────────────
(async () => {
    if (!TL()) return;
    const s = await window.electronAPI?.settings?.get?.() || {};
    if (s.crashAlert === false) return;
    const crashed = await TL().crashCheck();
    if (crashed) {
        const n = new Notification('上次异常退出', { body: '应用上次非正常退出（可能崩溃或被强制结束）。如果反复出现，请查看终端日志。' });
        n.onclick = () => { try { window.electronAPI?.app?.getVersion?.(); } catch (_) {} };
        n.show();
        setTimeout(() => { try { n.close(); } catch (_) {} }, 6000);
    }
})();

// ── B1 全局快捷键 ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); $('#btn-tools')?.click(); }
    else if (e.ctrlKey && e.shiftKey && e.key === 'R') { e.preventDefault(); webview?.reload(); }
    else if (e.ctrlKey && e.shiftKey && e.key === 'L') { e.preventDefault(); openSettings(); }
});

// ── 工具箱新区：导出 HTML / 角色卡速览 / 世界书 / 模型服务 / RAG ──
$('#t-export-html')?.addEventListener('click', async () => {
    const r = await TL()?.exportChatHtml();
    setNote(tEl.exportRes, r?.error ? `❌ ${r.error}` : `✅ 已导出 ${r.count} 条消息 → ${r.dest}`);
});
(async () => {
    const cards = await TL()?.listCharacters() || [];
    const sel = $('#t-card-list');
    if (sel) sel.innerHTML = '<option value="">选择角色卡…</option>' + cards.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
})();
$('#t-card-view')?.addEventListener('click', async () => {
    const name = $('#t-card-list')?.value;
    if (!name) return;
    const r = await TL()?.cardPreview(name);
    setDetail($('#t-card-res'), r?.error ? '❌ ' + r.error :
        `【${r.name}】\n${r.description ? '描述: ' + r.description.slice(0, 200) : ''}\n${r.personality ? '性格: ' + r.personality.slice(0, 200) : ''}\n${r.scenario ? '场景: ' + r.scenario.slice(0, 200) : ''}\n${r.firstMes ? '开场白: ' + r.firstMes : ''}`.replace(/</g, '&lt;'));
});
$('#t-worlds')?.addEventListener('click', async () => {
    const books = await TL()?.worldBooks() || [];
    const total = books.reduce((a, b) => a + b.entries.length, 0);
    setNote($('#t-worlds-note'), `共 ${books.length} 个世界书 / ${total} 条目`);
    setDetail($('#t-env-res'), books.length ? books.map(b => `📖 ${b.name} (${b.entries.length} 条)\n` + b.entries.slice(0, 5).map(en => `  · ${en.comment || en.content.slice(0, 40)}`).join('\n')).join('\n') : '未找到世界书');
});
$('#t-model-service')?.addEventListener('click', async () => {
    setDetail(tEl.envRes, '探测中…');
    const r = await TL()?.modelService();
    if (!r) return;
    const icon = r.online ? '🟢' : '🔴';
    const typeName = { ollama: 'Ollama', claude: 'Claude', openai: 'OpenAI', openrouter: 'OpenRouter', 'openai-compatible': 'OpenAI 兼容（本地部署）' }[r.type] || r.type;
    let html = `${icon} ${typeName}: ${r.detail}\n${r.model ? '当前模型: ' + r.model : ''}`;
    if (r.loaded) html += `\n已加载: ${r.loaded.name}${r.loaded.vramGB ? ` · ${r.loaded.vramGB}GB 显存` : ''}`;
    if (r.models?.length) html += `\n可用模型(${r.models.length}):\n` + r.models.slice(0, 12).map(m => `  · ${m.name}${m.sizeGB ? ` (${m.sizeGB}GB)` : ''}`).join('\n');
    setDetail(tEl.envRes, html);
});
$('#t-rag')?.addEventListener('click', async () => {
    const q = $('#t-rag-q')?.value.trim();
    if (!q) return;
    const hits = await TL()?.ragSearch(q) || [];
    setDetail($('#t-rag-res'), hits.length ? hits.map(h => `[${h.doc}] ${h.text}`).join('\n---\n') : '未命中（文档放 %APPDATA%\\sillytavern-electron\
ag-docs\\ 目录）');
});

// ── 🌐 公网隧道 (Cloudflare) ───────────────────────────────────────
const tunnelSel = $('#t-tunnel'), tunnelStatus = $('#t-tunnel-status'), tunnelCopy = $('#t-tunnel-copy');
let tunnelUrl = '', tunnelWatchdog = null;
function clearTunnelWatchdog() { if (tunnelWatchdog) { clearTimeout(tunnelWatchdog); tunnelWatchdog = null; } }
function startTunnelWatchdog() {
    clearTunnelWatchdog();
    tunnelWatchdog = setTimeout(() => {
        if (!tunnelUrl && tunnelStatus && !tunnelStatus.textContent.includes('❌')) {
            setNote(tunnelStatus, '⏳ 仍在连接，请检查网络/代理 (127.0.0.1:7890)…');
            tunnelStatus.className = 'update-status info';
        }
    }, 20000);
}
function tunnelRender(v) {
    if (!tunnelStatus || !v) return;
    if (v.url) { clearTunnelWatchdog(); tunnelUrl = v.url; setNote(tunnelStatus, `✅ ${v.url}`); tunnelStatus.className = 'update-status success'; if (tunnelCopy) tunnelCopy.style.display = ''; if (tunnelSel && tunnelSel.value !== '1') tunnelSel.value = '1'; }
    else if (v.error) { setNote(tunnelStatus, '❌ ' + v.error); tunnelStatus.className = 'update-status error'; if (tunnelCopy) tunnelCopy.style.display = 'none'; if (tunnelSel) tunnelSel.value = '0'; }
    else if (!v.running) { if (tunnelSel && tunnelSel.value === '1') { setNote(tunnelStatus, '已停止'); tunnelStatus.className = 'update-status info'; } }
}
tunnelSel?.addEventListener('change', async () => {
    const on = tunnelSel.value === '1';
    if (on) {
        setNote(tunnelStatus, '⏳ 开启中…'); tunnelStatus.className = 'update-status info';
        const r = await TL()?.tunnelStart();
        if (r?.error) { tunnelSel.value = '0'; setNote(tunnelStatus, '❌ ' + r.error); tunnelStatus.className = 'update-status error'; }
    } else {
        await TL()?.tunnelStop();
        tunnelUrl = '';
        setNote(tunnelStatus, ''); tunnelStatus.className = '';
        if (tunnelCopy) tunnelCopy.style.display = 'none';
    }
});
tunnelCopy?.addEventListener('click', async () => {
    if (!tunnelUrl) return;
    try { await navigator.clipboard.writeText(tunnelUrl); setNote(tunnelStatus, `✅ ${tunnelUrl}（已复制）`); } catch (_) { window.prompt('公网地址:', tunnelUrl); }
});
TL()?.tunnelOnState?.(tunnelRender);

// ── 状态栏诊断（运行时注入，不修改 ST 本体）──
function setDiag(text, isError) { const el = document.getElementById('t-diag-res'); if (el) { el.textContent = text; el.style.color = isError ? '#e0556a' : ''; } }
let lastDiagUnknown = [];
async function diagStatusBar() {
    setDiag('诊断中…');
    try {
        const saved = await window.electronAPI?.settings?.get?.() || {};
        const savedSelectors = Array.isArray(saved.knownStatusBarSelectors) ? saved.knownStatusBarSelectors : [];
        const r = await webview.executeJavaScript(`((savedSelectors) => {
            const out = { readyState: document.readyState, placeholder: false, markers: {}, runtime: false, context: null, statKeys: [], foundSelectors: [], unknownSelectors: [] };
            const html = document.body ? document.body.innerHTML : '';
            out.placeholder = /<\\s*StatusPlaceHolderImpl\\s*\\/\\s*>/i.test(html);
            const builtin = { typeA: ['.status-wrapper', '.status-card'], typeB: ['#swj-orb', '#swj-panel'], typeC: ['.qp-app', '.qp-title', '#qp-list'] };
            function pushFound(type, sel) {
                out.markers[type] = out.markers[type] || [];
                if (!out.markers[type].includes(sel)) out.markers[type].push(sel);
                if (!out.foundSelectors.includes(sel)) out.foundSelectors.push(sel);
            }
            function scan(root) {
                const doc = root.document || root;
                for (const [type, sels] of Object.entries(builtin)) {
                    for (const sel of sels) {
                        try { if (doc.querySelector(sel)) pushFound(type, sel); } catch (_) {}
                    }
                }
                for (const sel of savedSelectors) {
                    try { if (doc.querySelector(sel)) pushFound('saved', sel); } catch (_) {}
                }
                try {
                    const all = doc.querySelectorAll('*');
                    for (const el of all) {
                        if (!el || typeof el.getAttribute !== 'function') continue;
                        const cls = String(el.className || el.id || '');
                        if (!/status|orb|panel|card|hud|statusbar/i.test(cls)) continue;
                        const cs = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 50 && rect.height > 20 && (cs.position === 'fixed' || parseInt(cs.zIndex || 0, 10) > 100 || /status|orb|panel|card|hud/i.test(cls))) {
                            const id = el.id ? '#' + el.id : '';
                            const className = String(el.className || '').trim().split(/\\s+/)[0];
                            const sel = id || (className ? '.' + className : el.tagName.toLowerCase());
                            if (!out.foundSelectors.includes(sel)) { out.foundSelectors.push(sel); out.unknownSelectors.push(sel); }
                        }
                    }
                } catch (_) {}
                try { for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentDocument) scan(f.contentDocument); } catch (_) {} } } catch (_) {}
                try { for (const el of doc.querySelectorAll('*')) { if (el.shadowRoot) scan(el.shadowRoot); } } catch (_) {}
            }
            scan(document);
            try { out.runtime = !!window.__SWJ_STATUSBAR_RUNTIME__; } catch (_) {}
            try {
                const ctx = window.SillyTavern?.getContext?.();
                if (ctx) out.context = { characterId: ctx.characterId, chatId: ctx.chatId, groupId: ctx.groupId, preset: ctx.preset || ctx.chatCompletionSettings?.preset || null, source: ctx.chatCompletionSettings?.chat_completion_source || null };
            } catch (_) {}
            try {
                const vars = typeof getAllVariables === 'function' ? getAllVariables() : (window.Mvu?.getMvuData ? Mvu.getMvuData({ type: 'message', message_id: 'latest' }) : null);
                if (vars && vars.stat_data) out.statKeys = Object.keys(vars.stat_data).slice(0, 50);
            } catch (_) {}
            return out;
        })(${JSON.stringify(savedSelectors)})`);
        const lines = [];
        lines.push('页面状态: ' + (r.readyState || 'unknown'));
        lines.push('占位符残留: ' + (r.placeholder ? '是' : '否'));
        lines.push('脚本运行时: ' + (r.runtime ? '存在' : '无'));
        if (r.context) lines.push('角色/聊天: ' + r.context.characterId + ' / ' + r.context.chatId + (r.context.groupId ? ' (群聊)' : '') + ' | 预设: ' + (r.context.preset || '未知'));
        lines.push('状态栏标记: ' + (r.foundSelectors && r.foundSelectors.length ? r.foundSelectors.join(', ') : '未发现'));
        lines.push('stat_data 字段数: ' + (r.statKeys ? r.statKeys.length : 0));
        if (r.statKeys && r.statKeys.length) lines.push('字段前10: ' + r.statKeys.slice(0, 10).join(', '));
        if (r.placeholder && !r.foundSelectors.length) lines.push('结论: 占位符残留且状态栏 DOM 未注入，很可能为模板/预设替换失败');
        else if (r.foundSelectors && r.foundSelectors.length) lines.push('结论: 检测到状态栏相关元素' + (r.unknownSelectors && r.unknownSelectors.length ? '，包含未识别的新类型（可点“记住新类型”）' : ''));
        else lines.push('结论: 未检测到已知状态栏实现');
        lastDiagUnknown = r.unknownSelectors || [];
        setDiag(lines.join('\n'));
    } catch (e) { setDiag('诊断失败: ' + e.message, true); }
}
document.getElementById('t-remember-statusbar')?.addEventListener('click', async () => {
    if (!lastDiagUnknown.length) { setDiag('没有可记住的新类型，请先运行诊断', true); return; }
    const s = await window.electronAPI?.settings?.get?.() || {};
    const known = Array.isArray(s.knownStatusBarSelectors) ? s.knownStatusBarSelectors.slice() : [];
    for (const sel of lastDiagUnknown) if (!known.includes(sel)) known.push(sel);
    await window.electronAPI?.settings?.save?.({ knownStatusBarSelectors: known });
    setDiag('✅ 已记住 ' + lastDiagUnknown.length + ' 个状态栏选择器：\n' + lastDiagUnknown.join('\n'));
});
async function fixStatusBar() {
    setDiag('清理中…');
    try {
        const r = await webview.executeJavaScript(`(() => {
            let replaced = 0;
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            for (const node of nodes) {
                if (node.nodeValue && /<\\s*StatusPlaceHolderImpl\\s*\\/\\s*>/i.test(node.nodeValue)) {
                    const div = document.createElement('div');
                    div.id = 'shell-statusbar-fallback';
                    node.parentNode.replaceChild(div, node);
                    replaced++;
                }
            }
            return { replaced };
        })()`);
        setDiag(r.replaced ? '已清理 ' + r.replaced + ' 处占位符残留' : '未发现占位符残留');
    } catch (e) { setDiag('清理失败: ' + e.message, true); }
}
document.getElementById('t-diag-statusbar')?.addEventListener('click', diagStatusBar);
document.getElementById('t-fix-statusbar')?.addEventListener('click', fixStatusBar);
async function renderGenericStatusBar() {
    setDiag('渲染中…');
    try {
        const r = await webview.executeJavaScript(`(() => {
            const out = { rendered: false, reason: '' };
            try {
                let vars = typeof getAllVariables === 'function' ? getAllVariables() : (window.Mvu?.getMvuData ? Mvu.getMvuData({ type: 'message', message_id: 'latest' }) : null);
                const stat = (vars && vars.stat_data) || {};
                const charName = (window.SillyTavern?.getContext?.()?.characters?.[window.SillyTavern?.getContext?.()?.characterId]?.name) || stat.角色 || '角色';
                const d = stat['角色'] && stat['角色'][charName] ? stat['角色'][charName] : stat[charName] || {};
                const progress = stat.progress || stat['进度'] || '—';
                const place = stat['所在地'] || stat['当前地点'] || stat['世界']?.['当前地点'] || '—';
                const love = d['好感度'] || d['好感'] || '—';
                const state = d['身体状态'] || d['状态'] || '—';
                const inner = d['内心'] || d['inner'] || '—';
                const clothes = d['衣着'] || d['clothes'] || '—';
                const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const html = '<div style="position:fixed;bottom:8px;right:8px;z-index:2147483000;max-width:340px;background:#1c1c1e;color:#f0ede6;border:1px solid #c9a227;border-radius:10px;padding:10px 14px;font-size:13px;line-height:1.6;box-shadow:0 8px 30px rgba(0,0,0,.6);font-family:Microsoft YaHei,sans-serif;">' +
                    '<div style="font-weight:700;color:#c9a227;margin-bottom:6px;">' + esc(charName) + '</div>' +
                    '<div>进度：' + esc(progress) + '</div>' +
                    '<div>所在地：' + esc(place) + '</div>' +
                    '<div>好感度：' + esc(love) + '</div>' +
                    '<div>状态：' + esc(state) + '</div>' +
                    '<div>内心：' + esc(inner) + '</div>' +
                    '<div>衣着：' + esc(clothes) + '</div>' +
                    '</div>';
                let target = document.getElementById('shell-statusbar-fallback');
                if (!target) {
                    target = document.createElement('div');
                    target.id = 'shell-statusbar-fallback';
                    document.body.appendChild(target);
                }
                target.innerHTML = html;
                out.rendered = true;
            } catch (e) { out.reason = e.message; }
            return out;
        })()`);
        setDiag(r.rendered ? '✅ 已渲染通用状态栏' : '渲染失败: ' + r.reason, !r.rendered);
    } catch (e) { setDiag('渲染失败: ' + e.message, true); }
}
document.getElementById('t-render-statusbar')?.addEventListener('click', renderGenericStatusBar);

// ── ZeroTier 助手（虚拟局域网，不影响 Clash 代理）──
const ztEl = { status: $('#zt-status'), netid: $('#zt-netid'), netlist: $('#zt-netlist'), join: $('#zt-join'), leave: $('#zt-leave'), copy: $('#zt-copy'), allow: $('#zt-allow'), info: $('#zt-info') };
function ztSetNote(text, cls) { if (ztEl.status) { ztEl.status.textContent = text; ztEl.status.className = cls || ''; } }
function ztSetDetail(text) { if (ztEl.info) ztEl.info.textContent = text; }
async function ztRefresh() {
    ztSetNote('检测中…', 'tool-note');
    try {
        const s = await window.electronAPI?.zeroTier?.status?.();
        if (!s?.installed) { ztSetNote('❌ 未安装 ZeroTier', 'update-status error'); ztSetDetail('请到 https://www.zerotier.com/download/ 安装客户端'); return; }
        if (!s?.running) { ztSetNote('❌ ZeroTier 未运行', 'update-status error'); ztSetDetail('请启动 ZeroTier One 服务后重试'); return; }
        ztSetNote('✅ ZeroTier 运行中', 'update-status success');
        const lines = [];
        if (ztEl.netlist) {
            ztEl.netlist.innerHTML = '<option value="">已加入网络…</option>' + (s.networks || []).map(n => `<option value="${escapeHtml(String(n.id))}">${escapeHtml(String(n.name || n.id))} (${escapeHtml(String(n.status || ''))})</option>`).join('');
            const saved = await window.electronAPI?.settings?.get?.();
            if (saved?.ztNetworkId && ztEl.netid) ztEl.netid.value = saved.ztNetworkId;
            if (ztEl.allow) ztEl.allow.checked = !!saved?.disableWhitelist;
        }
        if (s.networks && s.networks.length) lines.push('已加入网络:\n' + s.networks.map(n => `  ${n.name || n.id} ${n.id} ${n.status || ''} ${n.ip || ''}`).join('\n'));
        if (s.ip) lines.push('ZeroTier IP: ' + s.ip + '\n访问地址: http://' + s.ip + ':8000');
        if (s.clashTun) lines.push('⚠ 检测到 Clash TUN(127.0.0.1:7890)\n若 ZeroTier 不通，请在 Clash 中绕过 172.16.0.0/12 和 10.0.0.0/8');
        ztSetDetail(lines.join('\n'));
    } catch (e) { ztSetNote('检测失败: ' + e.message, 'update-status error'); }
}
ztEl.join?.addEventListener('click', async () => {
    const id = ztEl.netid.value.trim();
    if (!id) { ztSetNote('请输入网络 ID', 'update-status error'); return; }
    ztSetNote('加入中…', 'update-status info');
    const r = await window.electronAPI?.zeroTier?.join?.(id);
    if (r?.error) { ztSetNote('❌ ' + r.error, 'update-status error'); return; }
    ztSetNote('✅ 已发出加入请求', 'update-status success');
    setTimeout(ztRefresh, 1500);
});
ztEl.leave?.addEventListener('click', async () => {
    const id = ztEl.netid.value.trim();
    if (!id) { ztSetNote('请输入网络 ID', 'update-status error'); return; }
    const r = await window.electronAPI?.zeroTier?.leave?.(id);
    if (r?.error) { ztSetNote('❌ ' + r.error, 'update-status error'); return; }
    ztSetNote('✅ 已离开网络', 'update-status success');
    setTimeout(ztRefresh, 1500);
});
ztEl.copy?.addEventListener('click', async () => {
    try {
        const s = await window.electronAPI?.zeroTier?.status?.();
        if (s?.ip) { await navigator.clipboard.writeText('http://' + s.ip + ':8000'); ztSetNote('✅ 已复制 ' + s.ip + ':8000', 'update-status success'); }
        else ztSetNote('未获取到 ZeroTier IP', 'update-status error');
    } catch (_) {}
});
ztEl.netlist?.addEventListener('change', () => {
    const id = ztEl.netlist.value;
    if (id && ztEl.netid) ztEl.netid.value = id;
});
ztEl.allow?.addEventListener('change', async () => {
    const on = !!ztEl.allow.checked;
    await window.electronAPI?.settings?.save?.({ disableWhitelist: on });
    ztSetNote(on ? '✅ 已开启自动放行白名单，重启服务器生效' : '已关闭自动放行白名单', 'update-status ' + (on ? 'success' : 'info'));
});
// 启动时恢复隧道状态
(async () => { const t = await TL()?.tunnelStatus(); if (t) { tunnelRender(t); if (t.url && tunnelSel) tunnelSel.value = '1'; } })();

// 工具箱打开时也渲染设置项（设置面板共用 renderTools）
tEl.btn?.addEventListener('click', () => {
    if (!tEl.panel) return;
    const open = tEl.panel.classList.toggle('hidden');
    if (!open) { renderTools(); renderUiSettings().catch(() => {}); (async () => { const t = await TL()?.tunnelStatus(); if (t) tunnelRender(t); })(); ztRefresh(); }
});
tEl.close?.addEventListener('click', () => tEl.panel?.classList.add('hidden'));
// 备份
tEl.backupNow?.addEventListener('click', async () => {
    if (!TL()) return;
    setNote(tEl.backupNowRes, '备份中…');
    const r = await TL().backupNow();
    setNote(tEl.backupNowRes, r?.ok ? `✅ ${r.dest}` : `❌ ${r?.error || '失败'}`);
    await renderTools();
});
document.getElementById('t-backup-restore')?.addEventListener('click', async () => {
    const sel = document.getElementById('t-backup-select');
    const name = sel?.value;
    if (!name) { setNote(tEl.backupNowRes, '请先选择要恢复的备份'); return; }
    const ok = await showConfirm({ title: '恢复备份', message: '确定从备份恢复数据？恢复前会自动备份当前数据，服务器会暂时重启。', confirmText: '恢复', danger: true });
    if (!ok) return;
    setNote(tEl.backupNowRes, '恢复中…');
    const r = await window.electronAPI?.tools?.backupRestore?.(name);
    setNote(tEl.backupNowRes, r?.ok ? '✅ 恢复完成' : '❌ 恢复失败: ' + (r?.error || '未知错误'));
    await renderTools();
});
tEl.backupDir?.addEventListener('change', async () => {
    await TL()?.backupSave({ dir: tEl.backupDir.value.trim() });
    setNote(tEl.backupInfo, '已保存目标目录');
});
tEl.backupAuto?.addEventListener('change', async () => {
    const on = tEl.backupAuto.checked;
    const h = Number(tEl.backupInterval.value) || 24;
    await TL()?.backupSave({ auto: on, intervalH: h });
    setNote(tEl.backupInfo, on ? `✅ 已开启自动备份（每 ${h} 小时）` : '已关闭自动备份');
});
tEl.backupInterval?.addEventListener('change', async () => {
    const h = Number(tEl.backupInterval.value) || 24;
    const on = tEl.backupAuto.checked;
    await TL()?.backupSave({ auto: on, intervalH: h });
    setNote(tEl.backupInfo, on ? `✅ 自动备份频率改为每 ${h} 小时` : '自动备份未开启');
});
tEl.backupKeep?.addEventListener('change', async () => { await TL()?.backupSave({ keep: Number(tEl.backupKeep.value) || 5 }); });
// 搜索
async function doSearch() {
    const kw = tEl.searchKw.value.trim();
    if (!kw) return;
    const r = await TL()?.searchChats(kw);
    if (!r) return;
    const res = r.results || [];
    if (!res.length) { setDetail(tEl.searchRes, `未找到「${kw}」相关消息（扫描 ${r.totalFiles} 个聊天文件）`); return; }
    setDetailHtml(tEl.searchRes, `找到 ${res.length} 条${r.truncated ? '（已截断）' : ''}（扫描 ${r.totalFiles} 个文件）：\n` +
        res.map(h => `<span class="hit">[${escapeHtml(h.char)}] ${escapeHtml(h.name)}: ${escapeHtml(h.snippet)}</span>`).join(''));
}
tEl.searchKw?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
// 统计
tEl.stats?.addEventListener('click', async () => {
    const s = await TL()?.chatStats();
    if (!s) return;
    setNote(tEl.statsRes, `✅ ${s.chats} 个聊天文件 / ${s.totalMessages} 条消息 / ${Math.round(s.totalChars / 10000) / 100} 万字（回复 ${s.replyChars} 字符）`);
    setDetail(tEl.searchRes, '各角色卡：\n' + s.perChar.slice(0, 12).map(c => `${c.char}: ${c.messages} 条 / ${c.chars} 字 / 回复 ${c.replyChars} 字`).join('\n'));
});
// 导出
tEl.exportCards?.addEventListener('click', async () => {
    const r = await TL()?.exportCharacters();
    setNote(tEl.exportRes, r?.error ? `❌ ${r.error}` : r?.canceled ? '' : `✅ 已导出 ${r.count} 张卡 → ${r.dest}`);
});
tEl.summarize?.addEventListener('click', async () => {
    setNote(tEl.exportRes, '总结中…（调用当前模型）');
    const r = await TL()?.summarizeChat();
    setNote(tEl.exportRes, r?.error ? `❌ ${r.error}` : `✅ 已导出 → ${r.dest}`);
    if (r?.summary) setDetail(tEl.searchRes, r.summary.slice(0, 800));
});
tEl.portable?.addEventListener('click', async () => {
    const r = await TL()?.portablePick();
    setNote(tEl.exportRes, r?.error ? `❌ ${r.error}` : r?.canceled ? '' : `✅ 便携包已生成 → ${r.dest}`);
});
// 环境
tEl.env?.addEventListener('click', async () => {
    setDetail(tEl.envRes, '体检中…');
    const checks = await TL()?.envCheck();
    if (!checks) return;
    setDetail(tEl.envRes, checks.map(c => `${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail}`).join('\n'));
});
document.getElementById('t-health')?.addEventListener('click', async () => {
    setDetail(tEl.envRes, '一键体检中…');
    const checks = await window.electronAPI?.tools?.healthCheck?.();
    if (!checks) return;
    setDetail(tEl.envRes, checks.map(c => `${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail}`).join('\n'));
});
tEl.ollama?.addEventListener('click', async () => {
    refreshOllamaStatus();
    setDetail(tEl.envRes, '加载中…');
    const r = await TL()?.ollamaModels();
    if (r?.error) { setDetail(tEl.envRes, '❌ ' + r.error); return; }
    const ps = await TL()?.ollamaPs();
    const loaded = new Set((ps?.models || []).map(m => m.name));
    setDetailHtml(tEl.envRes, `Ollama 在线，${r.models.length} 个模型：\n` + r.models.map(m =>
        `${loaded.has(m.name) ? '🟢' : '⚪'} ${escapeHtml(String(m.name))} (${escapeHtml(String(m.sizeGB))}GB ${escapeHtml(String(m.params))} ${escapeHtml(String(m.quant))})` +
        `<br><button class="btn-secondary" style="padding:1px 6px;font-size:10px" data-oa="load|${escapeHtml(String(m.name))}">加载</button>` +
        `<button class="btn-secondary" style="padding:1px 6px;font-size:10px" data-oa="unload|${escapeHtml(String(m.name))}">卸载</button>`
    ).join('<br>'));
    tEl.envRes.querySelectorAll('[data-oa]').forEach(b => b.addEventListener('click', async () => {
        const [a, m] = b.dataset.oa.split('|');
        await TL()?.ollamaAction(a, m);
        tEl.ollama.click();
    }));
});

async function refreshOllamaStatus() {
    const st = await TL()?.ollamaStatus();
    const el = document.getElementById('t-ollama-status');
    if (!el) return;
    if (!st) { el.textContent = ''; el.className = 'tool-note'; return; }
    if (st.running) { el.textContent = '✅ 运行中'; el.className = 'tool-note update-status success'; }
    else if (st.binary) { el.textContent = '未运行'; el.className = 'tool-note update-status error'; }
    else { el.textContent = '未安装'; el.className = 'tool-note update-status error'; }
}
document.getElementById('t-ollama-start')?.addEventListener('click', async () => {
    const st = await TL()?.ollamaStatus();
    const el = document.getElementById('t-ollama-status');
    if (!st) return;
    if (st.running) { refreshOllamaStatus(); return; }
    if (!st.binary) { if (el) el.textContent = '未安装 Ollama'; return; }
    if (el) el.textContent = '启动中…';
    const r = await TL()?.ollamaStart();
    if (r?.ok) { showToast('Ollama 已启动', 'success'); }
    else if (el) el.textContent = '启动失败: ' + (r?.error || '');
    refreshOllamaStatus();
});
refreshOllamaStatus();

const llamaCfgKey = 'llamaCfg';
function llamaLoadCfg() { try { return JSON.parse(localStorage.getItem(llamaCfgKey) || '{}'); } catch (_) { return {}; } }
function llamaSaveCfg(cfg) { localStorage.setItem(llamaCfgKey, JSON.stringify(cfg)); }
function llamaCfgFromInputs() {
    return {
        bin: ($('#llama-bin')?.value || '').trim(),
        model: ($('#llama-model')?.value || '').trim(),
        port: parseInt($('#llama-port')?.value) || 8080,
        ctx: parseInt($('#llama-ctx')?.value) || 4096,
        threads: parseInt($('#llama-threads')?.value) || 0,
        gpuLayers: parseInt($('#llama-gpu')?.value) ?? 0,
    };
}
function llamaCfgToInputs(cfg) {
    if (!cfg) return;
    if ($('#llama-bin')) $('#llama-bin').value = cfg.bin || '';
    if ($('#llama-model')) $('#llama-model').value = cfg.model || '';
    if ($('#llama-port')) $('#llama-port').value = cfg.port || 8080;
    if ($('#llama-ctx')) $('#llama-ctx').value = cfg.ctx || 4096;
    if ($('#llama-threads')) $('#llama-threads').value = cfg.threads || 0;
    if ($('#llama-gpu')) $('#llama-gpu').value = cfg.gpuLayers ?? 0;
}
async function llamaRefresh() {
    const cfg = llamaCfgFromInputs();
    const st = await TL()?.llamaStatus(cfg.port);
    const note = document.getElementById('llama-status-note');
    if (!note) return;
    if (!st) { note.textContent = '…'; note.className = 'tool-note'; return; }
    if (st.running) { note.textContent = '✅ 运行中 :' + st.port; note.className = 'tool-note update-status success'; }
    else { note.textContent = '未运行'; note.className = 'tool-note update-status error'; }
}
function llamaBind() { llamaCfgToInputs(llamaLoadCfg()); ['llama-bin','llama-model','llama-port','llama-ctx','llama-threads','llama-gpu'].forEach(id => document.getElementById(id)?.addEventListener('input', () => llamaSaveCfg(llamaCfgFromInputs()))); }
llamaBind();
document.getElementById('llama-start')?.addEventListener('click', async () => {
    const cfg = llamaCfgFromInputs(); llamaSaveCfg(cfg);
    const note = document.getElementById('llama-status-note'); if (note) note.textContent = '启动中…';
    const r = await TL()?.llamaStart(cfg);
    if (r?.ok) { showToast('llama.cpp 已启动 :' + r.port, 'success'); }
    else if (note) note.textContent = '启动失败: ' + (r?.error || '');
    llamaRefresh();
});
document.getElementById('llama-stop')?.addEventListener('click', async () => {
    const cfg = llamaCfgFromInputs(); llamaSaveCfg(cfg);
    const r = await TL()?.llamaStop(cfg.port);
    if (r?.ok) showToast('llama.cpp 已停止', 'success');
    else showToast('停止失败: ' + (r?.error || ''), 'error');
    llamaRefresh();
});
document.getElementById('llama-status')?.addEventListener('click', llamaRefresh);
llamaRefresh();

tEl.gpu?.addEventListener('click', async () => {
    const g = await TL()?.gpuStats();
    setDetail(tEl.envRes, g ? `🖥 ${g.usedGB}/${g.totalGB} GB 显存 | ${g.temp}°C | 利用率 ${g.util}%` : '无法读取 nvidia-smi');
});
tEl.clash?.addEventListener('click', async () => {
    const ok = await TL()?.clashCheck();
    setDetail(tEl.envRes, ok ? '✅ Clash 代理 7890 在线' : '❌ Clash 代理 7890 不可达');
});
// 草稿
tEl.draft?.addEventListener('click', async () => {
    const p = tEl.draftPrompt.value.trim();
    if (!p) return;
    tEl.draft.disabled = true; tEl.draft.textContent = '生成中…';
    const r = await TL()?.draftGenerate(p, 512);
    setDetail(tEl.draftRes, r?.error ? '❌ ' + r.error : r?.text || '(空)');
    tEl.draft.disabled = false; tEl.draft.textContent = '生成';
});
tEl.draftCopy?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(tEl.draftRes.textContent || ''); tEl.draftCopy.textContent = '已复制 ✓'; setTimeout(() => tEl.draftCopy.textContent = '复制', 1500); } catch (_) {}
});
// 独立对话
tEl.chat?.addEventListener('click', () => TL()?.chatOpen());
// 设置
tEl.autostart?.addEventListener('change', async () => {
    const on = tEl.autostart.value === '1';
    const r = await TL()?.autostartSet(on);
    setNote(tEl.rollbackInfo, r ? '✅ 开机自启已' + (on ? '开启' : '关闭') : '❌ 设置失败');
});
tEl.night?.addEventListener('change', async () => {
    await TL()?.nightSave({ enabled: tEl.night.value === '1', start: '22:00', end: '07:00' });
});
tEl.pinSet?.addEventListener('click', async () => {
    const code = tEl.pin.value.trim();
    await TL()?.pinSet(code || '');
    tEl.pin.value = '';
    setNote($('#t-pin-status'), code ? '✅ PIN 已设置' : '✅ PIN 已清除');
});
tEl.immerse?.addEventListener('click', async () => { await TL()?.immerseSet(); });
tEl.notify?.addEventListener('change', async () => {
    const s = await window.electronAPI?.settings?.get?.() || {};
    s.notifyGenerated = tEl.notify.value === '1';
    await window.electronAPI?.settings?.save?.(s);
});
// 启动即应用主题/字体/迷你窗等 UI 设置（无需打开设置面板）
(async () => { if (typeof renderUiSettings === 'function') { try { await renderUiSettings(); } catch (_) {} } })();

// ── 深夜模式监听
TL()?.onNight?.(v => document.body.classList.toggle('night', !!v));
// F11 沉浸
document.addEventListener('keydown', e => { if (e.key === 'F11') { e.preventDefault(); TL()?.immerseSet(); } });
// PIN 锁屏（启动时如有 PIN 则锁定）
(async () => {
    if (!TL()) return;
    const pg = await TL().pinGet();
    if (pg?.hasPin) {
        const ov = $('#lock-overlay');
        ov?.classList.remove('hidden');
        const inp = $('#lock-pin'), err = $('#lock-err'), btn = $('#lock-unlock');
        const tryUnlock = async () => {
            const ok = await TL().pinVerify(inp.value);
            if (ok) { ov.classList.add('hidden'); inp.value = ''; }
            else { err.textContent = 'PIN 错误'; inp.value = ''; inp.focus(); }
        };
        btn?.addEventListener('click', tryUnlock);
        inp?.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
        setTimeout(() => inp?.focus(), 100);
    }
})();

$('#btn-check-shell-update')?.addEventListener('click',checkShellUpdate);
async function checkShellUpdate(){const s=$('#shell-update-status');if(!s)return;s.textContent='检查中...';s.className='update-status info';const cur=await A?.getShellVersion();const SU=window.electronAPI?.shellUpdate;if(!SU){s.textContent='自动更新不可用';s.className='update-status error';return;}try{const r=await SU.check();const newer=r?.version&&cur&&String(r.version)!==String(cur)&&(String(r.version).localeCompare(String(cur),undefined,{numeric:true})>0);if(r?.hasUpdate&&newer){s.innerHTML=`发现新版本 <b>v${escapeHtml(String(r.version))}</b> (当前 v${escapeHtml(String(cur))})`;s.className='update-status success';let dl=$('#btn-dl-shell');if(!dl){dl=document.createElement('button');dl.id='btn-dl-shell';dl.className='btn-primary';dl.style.marginTop='6px';dl.textContent='下载并安装';dl.addEventListener('click',async()=>{if(dl.dataset.done)return;dl.disabled=true;dl.textContent='下载中...';s.innerHTML='下载中...';s.className='update-status info';const sp=$('#shell-update-progress'),sf=$('#shell-progress-fill'),st=$('#shell-progress-text');if(sp){sp.classList.remove('hidden');if(sf)sf.style.width='0%';if(st)st.textContent='0%';}let cleanup=SU.onProgress(({percent})=>{if(sf)sf.style.width=`${Math.round(percent||0)}%`;if(st)st.textContent=`${Math.round(percent||0)}%`;dl.textContent=`下载中 ${Math.round(percent||0)}%`;});let dc=SU.onDownloaded(()=>{cleanup();dc();if(sp)sp.classList.add('hidden');dl.dataset.done='1';s.innerHTML='✅ 下载完成，正在安装...';s.className='update-status success';dl.textContent='安装中...';setTimeout(()=>SU.install(),800);});let ec=SU.onError(e=>{cleanup();dc();ec();if(sp)sp.classList.add('hidden');delete dl.dataset.done;s.textContent='下载失败: '+e;s.className='update-status error';dl.disabled=false;dl.textContent='重试';});try{await SU.download();}catch(e){cleanup();dc();ec();if(sp)sp.classList.add('hidden');delete dl.dataset.done;s.textContent='下载失败: '+e;s.className='update-status error';dl.disabled=false;dl.textContent='重试';}});s.appendChild(dl);}}else if(r?.error){s.textContent=(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|network|Network/i.test(r.error))?'⚠ 网络连接失败 — 请检查网络或代理 (127.0.0.1:7890)':'检查失败: '+r.error;s.className='update-status error';}else{s.textContent='已是最新版本 (v'+cur+')';s.className='update-status info';}}catch(e){s.textContent='检查失败: '+e.message;s.className='update-status error';}}
