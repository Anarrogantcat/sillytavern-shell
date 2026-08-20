const { window:W, server:S, terminal:T, settings:ST, app:A, update:U } = window.electronAPI||{};
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
S?.onUrl(url=>{serverReady=true;if(webview&&url)webview.src=url;});
// Pull fallback: if the server printed its URL before this page registered
// its listener (fast-start server), the push event was lost — recover it.
(async()=>{const u=await S?.getUrl();if(u&&!serverReady){serverReady=true;if(webview)webview.src=u;}})();
S?.onError(msg=>{if(loading){loading.classList.remove('hidden');const t=loading.querySelector('.loading-text');if(t)t.textContent='启动失败';if(loadingLog){loadingLog.textContent=msg;loadingLog.classList.add('show');}}});
S?.onSetupStarted?.(()=>{const t=loading?.querySelector('.loading-text');if(t)t.textContent='首次启动 — 正在安装 SillyTavern...';if(loadingLog){loadingLog.classList.add('show');loadingLog.scrollTop=loadingLog.scrollHeight;}});
webview?.addEventListener('dom-ready', async () => {
    loading?.classList.add('hidden'); webview.classList.remove('hidden'); webview.focus();
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
let termOpen=false,termHistory='',termBuf='',termTimer=null,termNodes=0;
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
    termOut.scrollTop=termOut.scrollHeight;
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
        termOut.scrollTop=termOut.scrollHeight;
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
termOut?.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='c'){const s=window.getSelection()?.toString();if(s){e.preventDefault();navigator.clipboard.writeText(s);}}});
termInput?.addEventListener('keydown',async e=>{if(e.key!=='Enter'||!termInput.value.trim())return;const cmd=termInput.value.trim();termInput.value='';termInput.disabled=true;termAppend(`> ${cmd}\n`);try{const r=await T?.exec(cmd);if(r.stdout)termAppend(r.stdout);if(r.stderr)termAppend(r.stderr);if(r.error)termAppend(`Error: ${r.error}\n`);}catch(err){termAppend(`${err.message}\n`);}termInput.disabled=false;termInput.focus();});

T?.onOutput(text=>{if(!serverReady&&loadingLog)loadingAppend(text);termAppend(text);});
(async()=>{const h=await T?.getHistory();if(h){termHistory=h;if(!serverReady&&loadingLog){loadingLog.classList.add('show');loadingLog.textContent=stripAnsi(h);loadingLog.scrollTop=loadingLog.scrollHeight;}}})();

// ── Settings ─────────────────────────────────
let settingsData={};
// 设置页 Tab：按现有 DOM 结构分组，不依赖额外 HTML 标记
function initSettingsTabs() {
    const tabs = document.querySelectorAll('#settings-tabs .settings-tab');
    if (!tabs.length) return;
    const body = document.querySelector('.settings-content') || document.querySelector('.settings-body');
    if (!body) return;
    const children = [...body.children].filter(el => el.id !== 'settings-tabs');
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
        for (const el of show) if (el) el.style.display = '';
        for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tab === name);
        try { localStorage.setItem('settingsTab', name); } catch (_) {}
    }
    for (const tab of tabs) tab.addEventListener('click', () => switchSettingsTab(tab.dataset.tab));
    switchSettingsTab(localStorage.getItem('settingsTab') || 'general');
}
initSettingsTabs();
async function openSettings(){settingsOverlay.classList.remove('hidden');settingsData=(await ST?.get())||{};const v=await A?.getVersion();$('#setting-server-path').value=settingsData.serverPath||'';$('#setting-data-root').value=(await ST?.getDataRoot())||'';$('#setting-width').value=settingsData.windowWidth||1280;$('#setting-height').value=settingsData.windowHeight||800;const cs=$('#setting-close-behavior');if(cs)cs.value=settingsData.closeBehavior||'ask';if($('#version-display'))$('#version-display').textContent=v||'unknown';if($('#shell-version-display'))$('#shell-version-display').textContent='v'+(await A?.getShellVersion()||'?');const sc=$('#server-ctl-status');if(sc)sc.textContent=sc.className='';const s=$('#update-status');if(s)s.textContent=s.className='';$('#btn-do-update')?.remove();$('#btn-view-update')?.remove();const p=$('#update-progress');if(p)p.classList.add('hidden');const ss=$('#shell-update-status');if(ss)ss.textContent=ss.className='';$('#btn-dl-shell')?.remove();checkShellUpdate();if(typeof renderTools==='function')renderTools();if(typeof renderUiSettings==='function')renderUiSettings();}
function closeSettings(){settingsOverlay.classList.add('hidden');}
btnSettings?.addEventListener('click',openSettings);
$('#btn-settings-close')?.addEventListener('click',closeSettings);
$('#btn-settings-cancel')?.addEventListener('click',closeSettings);
settingsOverlay?.addEventListener('click',e=>{if(e.target===settingsOverlay)closeSettings();});
$('#btn-settings-save')?.addEventListener('click',async()=>{const sp=$('#setting-server-path').value.trim();const w=parseInt($('#setting-width').value)||1280;const h=parseInt($('#setting-height').value)||800;const cb=$('#setting-close-behavior')?.value||'ask';const pathChanged=sp!==(settingsData.serverPath||'');const r=await ST?.save({serverPath:sp,windowWidth:w,windowHeight:h,closeBehavior:cb});if(r?.error){alert('保存失败：' + r.error);return;}closeSettings();if(pathChanged){alert('服务器路径已保存，重启套壳后生效。');}});

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
        if (confirm(`确定回滚到 v${b.dataset.rollback}？应用将退出并安装旧版。`)) {
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
async function renderUiSettings() {
    const u = await TL()?.uiGet();
    if (u) {
        $('#t-top').value = u.alwaysOnTop ? '1' : '0';
        $('#t-theme').value = u.theme || 'purple';
        $('#t-font').value = String(u.fontScale || 1);
        $('#t-mini').value = u.miniStatus ? '1' : '0';
        document.body.dataset.miniEnabled = u.miniStatus ? '1' : '0';
        if (u.miniStatus) miniDismissed = false; // 重新开启后恢复自动显示
        document.body.dataset.theme = u.theme || 'purple';
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
}
$('#t-lan')?.addEventListener('change', async () => {
    await TL()?.lanSave({ enabled: $('#t-lan').value === '1' });
    alert('局域网访问已' + ($('#t-lan').value === '1' ? '开启' : '关闭') + '，重启服务器后生效（设置→服务器控制→重启服务器）');
    await renderUiSettings();
});
$('#t-lan-user')?.addEventListener('change', async () => { await TL()?.lanSave({ user: $('#t-lan-user').value.trim() }); });
$('#t-lan-pass')?.addEventListener('change', async () => { await TL()?.lanSave({ pass: $('#t-lan-pass').value }); });
$('#t-top')?.addEventListener('change', async () => { await TL()?.uiSet('alwaysOnTop', $('#t-top').value === '1'); });
$('#t-theme')?.addEventListener('change', async () => { const v = $('#t-theme').value; await TL()?.uiSet('theme', v); document.body.dataset.theme = v; });
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
let tunnelUrl = '';
function tunnelRender(v) {
    if (!tunnelStatus || !v) return;
    if (v.url) { tunnelUrl = v.url; setNote(tunnelStatus, `✅ ${v.url}`); tunnelStatus.className = 'update-status success'; if (tunnelCopy) tunnelCopy.style.display = ''; if (tunnelSel && tunnelSel.value !== '1') tunnelSel.value = '1'; }
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
async function diagStatusBar() {
    setDiag('诊断中…');
    try {
        const r = await webview.executeJavaScript(`(() => {
            const out = { readyState: document.readyState, placeholder: false, markers: {}, runtime: false, context: null, statKeys: [] };
            const html = document.body ? document.body.innerHTML : '';
            out.placeholder = /<\\s*StatusPlaceHolderImpl\\s*\\/\\s*>/i.test(html);
            const markers = { typeA: ['.status-wrapper', '.status-card'], typeB: ['#swj-orb', '#swj-panel'], typeC: ['.qp-app', '.qp-title', '#qp-list'] };
            for (const [type, sels] of Object.entries(markers)) {
                out.markers[type] = [];
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const cs = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        out.markers[type].push({ sel, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, width: rect.width, height: rect.height });
                    }
                }
            }
            try { out.runtime = !!window.__SWJ_STATUSBAR_RUNTIME__; } catch (_) {}
            try {
                const ctx = window.SillyTavern?.getContext?.();
                if (ctx) {
                    out.context = { characterId: ctx.characterId, chatId: ctx.chatId, groupId: ctx.groupId, preset: ctx.preset || ctx.chatCompletionSettings?.preset || null, source: ctx.chatCompletionSettings?.chat_completion_source || null };
                }
            } catch (_) {}
            try {
                const vars = typeof getAllVariables === 'function' ? getAllVariables() : (window.Mvu?.getMvuData ? Mvu.getMvuData({ type: 'message', message_id: 'latest' }) : null);
                if (vars && vars.stat_data) out.statKeys = Object.keys(vars.stat_data).slice(0, 50);
            } catch (_) {}
            return out;
        })()`);
        const lines = [];
        lines.push('页面状态: ' + (r.readyState || 'unknown'));
        lines.push('占位符残留: ' + (r.placeholder ? '是' : '否'));
        lines.push('脚本运行时: ' + (r.runtime ? '存在' : '无'));
        if (r.context) lines.push('角色/聊天: ' + r.context.characterId + ' / ' + r.context.chatId + (r.context.groupId ? ' (群聊)' : '') + ' | 预设: ' + (r.context.preset || '未知'));
        const found = [];
        for (const [type, arr] of Object.entries(r.markers || {})) for (const m of arr) found.push(type + ':' + m.sel);
        lines.push('状态栏标记: ' + (found.length ? found.join(', ') : '未发现'));
        lines.push('stat_data 字段数: ' + (r.statKeys ? r.statKeys.length : 0));
        if (r.statKeys && r.statKeys.length) lines.push('字段前10: ' + r.statKeys.slice(0, 10).join(', '));
        if (r.placeholder && !found.length) lines.push('结论: 占位符残留且状态栏 DOM 未注入，很可能为模板/预设替换失败');
        else if (found.length) lines.push('结论: 状态栏 DOM 已注入，请查看上方标记样式判断是否隐藏');
        else lines.push('结论: 未检测到已知状态栏实现');
        setDiag(lines.join('\n'));
    } catch (e) { setDiag('诊断失败: ' + e.message, true); }
}
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
// 启动时恢复隧道状态
(async () => { const t = await TL()?.tunnelStatus(); if (t) { tunnelRender(t); if (t.url && tunnelSel) tunnelSel.value = '1'; } })();

// 工具箱打开时也渲染设置项（设置面板共用 renderTools）
tEl.btn?.addEventListener('click', () => {
    if (!tEl.panel) return;
    const open = tEl.panel.classList.toggle('hidden');
    if (!open) { renderTools(); renderUiSettings().catch(() => {}); (async () => { const t = await TL()?.tunnelStatus(); if (t) tunnelRender(t); })(); }
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
tEl.ollama?.addEventListener('click', async () => {
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
