const { window:W, server:S, terminal:T, settings:ST, app:A, update:U } = window.electronAPI||{};
const $=s=>document.querySelector(s);
const webview=$('#sillytavern-webview'),loading=$('#loading-overlay'),loadingLog=$('#loading-log');
const termPanel=$('#terminal-panel'),termOut=$('#terminal-output'),termInput=$('#terminal-input');
const btnTerm=$('#btn-terminal'),btnSettings=$('#btn-settings'),settingsOverlay=$('#settings-overlay');

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
webview?.addEventListener('dom-ready',()=>{loading?.classList.add('hidden');webview.classList.remove('hidden');webview.focus();});
// webview 右键（webview-preload 上报）→ 主进程弹菜单
webview?.addEventListener('ipc-message', (e) => {
    if (e.channel === 'ctxmenu') {
        const p = e.args?.[0] || {};
        A?.contextMenu?.({ kind: 'webview', x: p.x, y: p.y, hasSelection: p.hasSelection });
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
        termHeight=Math.min(termMaxHeight(),Math.max(TERM_HEIGHT_MIN,startH+dh));
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
    loadTimer=setTimeout(()=>{loadTimer=null;loadingLog.textContent+=loadBuf;loadBuf='';loadingLog.scrollTop=loadingLog.scrollHeight;},80);
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
async function openSettings(){settingsOverlay.classList.remove('hidden');settingsData=(await ST?.get())||{};const v=await A?.getVersion();$('#setting-server-path').value=settingsData.serverPath||'';$('#setting-data-root').value=(await ST?.getDataRoot())||'';$('#setting-width').value=settingsData.windowWidth||1280;$('#setting-height').value=settingsData.windowHeight||800;const cs=$('#setting-close-behavior');if(cs)cs.value=settingsData.closeBehavior||'ask';if($('#version-display'))$('#version-display').textContent=v||'unknown';if($('#shell-version-display'))$('#shell-version-display').textContent='v'+(await A?.getShellVersion()||'?');const sc=$('#server-ctl-status');if(sc)sc.textContent=sc.className='';const s=$('#update-status');if(s)s.textContent=s.className='';$('#btn-do-update')?.remove();$('#btn-view-update')?.remove();const p=$('#update-progress');if(p)p.classList.add('hidden');const ss=$('#shell-update-status');if(ss)ss.textContent=ss.className='';$('#btn-dl-shell')?.remove();checkShellUpdate();if(typeof renderTools==='function')renderTools();}
function closeSettings(){settingsOverlay.classList.add('hidden');}
btnSettings?.addEventListener('click',openSettings);
$('#btn-settings-close')?.addEventListener('click',closeSettings);
$('#btn-settings-cancel')?.addEventListener('click',closeSettings);
settingsOverlay?.addEventListener('click',e=>{if(e.target===settingsOverlay)closeSettings();});
$('#btn-settings-save')?.addEventListener('click',async()=>{const sp=$('#setting-server-path').value.trim();const w=parseInt($('#setting-width').value)||1280;const h=parseInt($('#setting-height').value)||800;const cb=$('#setting-close-behavior')?.value||'ask';const pathChanged=sp!==(settingsData.serverPath||'');await ST?.save({serverPath:sp,windowWidth:w,windowHeight:h,closeBehavior:cb});closeSettings();if(pathChanged){alert('服务器路径已保存，重启套壳后生效。');}});

// ── Server controls ─────────────────────────
$('#btn-restart-server')?.addEventListener('click',async()=>{const b=$('#btn-restart-server'),sc=$('#server-ctl-status');if(b)b.disabled=true;if(sc){sc.textContent='正在重启服务器...';sc.className='update-status info';}const r=await window.electronAPI?.server?.restart();if(sc){if(r?.success){sc.textContent='✅ 服务器已重启';sc.className='update-status success';}else{sc.textContent='重启失败: '+(r?.error||'unknown');sc.className='update-status error';}}if(b)b.disabled=false;});
$('#btn-open-st-dir')?.addEventListener('click',async()=>{const p=await ST?.getServerPath();if(p)window.electronAPI?.window?.openPath(p);});
$('#btn-open-data-dir')?.addEventListener('click',async()=>{const p=await ST?.getDataRoot();if(p)window.electronAPI?.window?.openPath(p);});
$('#btn-shell-changelog')?.addEventListener('click',async()=>{const md=await A?.getChangelog();const html=md.replace(/^# (.+)/gm,'<h3>$1</h3>').replace(/^## (.+)/gm,'<h4>$1</h4>').replace(/^- (.+)/gm,'<li>$1</li>').replace(/(<li>.*<\/li>)/gs,'<ul>$1</ul>');const el=document.createElement('div');el.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:999;display:flex;align-items:center;justify-content:center';el.innerHTML=`<div style=\"background:rgba(18,18,42,0.95);backdrop-filter:blur(20px);border-radius:12px;padding:20px;max-width:500px;max-height:80vh;overflow-y:auto;color:#c8c8d4;font-size:13px;line-height:1.6\"><div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:12px\"><h3 style=\"margin:0;color:#7c5cbf\">套壳更新日志</h3><button style=\"background:none;border:none;color:#c8c8d4;font-size:18px;cursor:pointer\">&times;</button></div>${html}</div>`;el.querySelector('button').onclick=()=>el.remove();el.onclick=e=>{if(e.target===el)el.remove();};document.body.appendChild(el);});

// ── Update ───────────────────────────────────
let updateData=null,updateCleanup=null;
$('#btn-check-update')?.addEventListener('click',checkUpdate);
$('#btn-update')?.addEventListener('click',async()=>{openSettings();checkUpdate();});
async function checkUpdate(){const b=$('#btn-check-update'),s=$('#update-status');if(b)b.disabled=true;if(s){s.textContent='检查中...';s.className='update-status info';}updateData=await U?.check();if(updateData?.error){if(s){s.textContent='检查失败: '+updateData.error;s.className='update-status error';}}else if(updateData?.hasUpdate){if(s){s.innerHTML=`发现新版本 <b>v${updateData.latest}</b> (当前 v${updateData.current})`;s.className='update-status success';}let ub=$('#btn-do-update');if(!ub){ub=document.createElement('button');ub.id='btn-do-update';ub.className='btn-primary';ub.textContent='立即更新';ub.addEventListener('click',doUpdate);$('.update-section').appendChild(ub);}let vu=$('#btn-view-update');if(!vu&&updateData?.url){vu=document.createElement('button');vu.id='btn-view-update';vu.className='btn-secondary';vu.textContent='查看更新日志';vu.style.marginTop='6px';vu.addEventListener('click',()=>{window.open(updateData.url,'_blank');});$('.update-section').appendChild(vu);}}else{if(s){s.textContent='已是最新版本 (v'+updateData.current+')';s.className='update-status info';}}if(b)b.disabled=false;}
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
$('#btn-check-integrity')?.addEventListener('click',async()=>{const s=$('#integrity-status');if(!s)return;s.textContent='检测中...';s.className='update-status info';try{
const script=`const fs=require('fs');let git=false;try{git=require('child_process').execSync('git rev-parse --is-inside-work-tree',{stdio:'pipe'}).toString().trim()==='true';}catch(_){git=false;}const out=[];if(git){try{const del=require('child_process').execSync('git ls-files --deleted',{stdio:'pipe'}).toString().trim().split('\\\\n').filter(l=>l&&!l.startsWith('data/'));del.forEach(l=>out.push('MISSING '+l));}catch(_){out.push('git 检查失败（目录可能未信任，正在使用文件检查）');['server.js','package.json','public/index.html'].forEach(f=>{if(!fs.existsSync(f))out.push('MISSING '+f);});}}else{['server.js','package.json','public/index.html'].forEach(f=>{if(!fs.existsSync(f))out.push('MISSING '+f);});}if(!fs.existsSync('node_modules'))out.push('MISSING node_modules');console.log(JSON.stringify({git,out}));`;
const r=await T?.exec('node -e "'+script.replace(/"/g,'\\"')+'"');
if(r?.error&&!r.stdout){s.textContent='检测失败: '+(r.stderr||r.error);s.className='update-status error';return;}
let data={git:false,out:[]};try{data=JSON.parse(r?.stdout||'{}');}catch(_){}
if(data.out.length===0){s.textContent=data.git?'✅ 所有文件完整 (git 安装)':'✅ 核心文件完整 (非 git 安装)';s.className='update-status success';}
else{s.innerHTML='<pre style=margin:0;font-size:11px;line-height:1.6;max-height:200px;overflow-y:auto>缺失文件：\\n'+data.out.join('\\n')+'</pre>';s.className='update-status error';}
}catch(e){s.textContent='检测失败: '+e.message;s.className='update-status error';}});

// Ctrl+Scroll zoom — now handled via webview preload + setZoomFactor (see Zoom section above)

// ── Model Benchmark panel ─────────────────────────────────────────
const benchEl = {
    panel: $('#bench-panel'), btn: $('#btn-bench'), model: $('#bench-model'), char: $('#bench-char'),
    hw: $('#bench-hw'), progress: $('#bench-progress'), sessions: $('#bench-sessions'),
    result: $('#bench-result'), run: $('#btn-bench-run'), copy: $('#btn-bench-copy'),
    reset: $('#btn-bench-reset'), close: $('#btn-bench-close'),
};
const B = () => window.electronAPI?.bench;
function fmtNum(n) { return (n ?? 0).toLocaleString('en-US'); }
async function renderBench() {
    if (!B()) return;
    const st = await B().status();
    if (!st) return;
    const m = st.model || {};
    benchEl.model.textContent = m.model ? `${m.model}` : '(未检测到模型)';
    benchEl.char.textContent = st.activeCharacter || '-';
    const hw = st.hardware || {};
    benchEl.hw.textContent = hw.gpu ? `${hw.gpu} ${hw.vramGB ? hw.vramGB + 'GB' : ''} / ${hw.memGB}GB 内存` : (hw.memGB ? `${hw.memGB}GB 内存 / ${hw.cpu}` : '检测中…');
    const sessions = st.sessions || [];
    const done = sessions.filter(s => !s.active).length;
    const cur = sessions.find(s => s.active);
    let prog = `已记录 ${done}/3 次对话`;
    if (cur) prog += `，当前对话进行中 (总 ${fmtNum(cur.total)} Tok${cur.reply ? ` / 回复 ${fmtNum(cur.reply)}` : ''})`;
    if (sessions.length === 0) prog = '等待对话…聊天 3 次后自动给出建议';
    benchEl.progress.textContent = prog;
    if (sessions.length) {
        benchEl.sessions.style.display = '';
        benchEl.sessions.textContent = sessions.map((s, i) =>
            `第${i + 1}次对话${s.active ? '(进行中)' : ''}: 总 ${fmtNum(s.total)} Tok / 角色卡回复 ${fmtNum(s.reply)} Tok`
        ).join('\n');
    } else benchEl.sessions.style.display = 'none';
    // benchmark + suggestion
    const bm = st.benchmark, sg = st.suggestion;
    if (sg) {
        const lines = [
            `建议上下文长度: <span class="sugg-big">${fmtNum(sg.suggestCtx)}</span>`,
            `建议最大回复长度: <span class="sugg-big">${fmtNum(sg.suggestResp)}</span>`,
            `<span class="sugg-note">推导: 对话总 ${fmtNum(sg.totalHistory)} + 最高回复 ${fmtNum(sg.maxReply)} + 固定开销 ${sg.baseOverhead} = 需求 ${fmtNum(sg.totalHistory + sg.maxReply + sg.baseOverhead)}, ×1.25 → ${fmtNum(sg.ctxByNeed)}；受模型上限 ${sg.ctxByModel === Infinity ? '未知' : fmtNum(sg.ctxByModel)}、显存预算 ${sg.ctxByVram === Infinity ? '未知' : fmtNum(sg.ctxByVram)} 约束</span>`,
            `<span class="sugg-note">回复长度: 最高回复 ×1.1 → ${fmtNum(sg.respByUsage)}；受速度 ${bm ? bm.tokPerSec + ' tok/s ×60s → ' + fmtNum(sg.respBySpeed) : '待测速'}、上下文/8 → ${fmtNum(sg.respByCtx)} 约束</span>`,
        ];
        benchEl.result.innerHTML = lines.join('<br>');
        benchEl.copy.style.display = '';
    } else if (bm) {
        benchEl.result.innerHTML = `<span class="bench-ok">✅ 测速完成: ${bm.tokPerSec} tok/s</span> (首 token ${bm.ttftMs}ms, 3 次: ${(bm.runs || []).join(', ')})<br><span class="sugg-note">还需 ${Math.max(0, 3 - done)} 次对话数据才能给出建议</span>`;
        benchEl.copy.style.display = 'none';
    } else {
        benchEl.result.innerHTML = '<span class="sugg-note">点击「开始测速」实测生成速度；正常聊天 3 次后自动给出建议。</span>';
        benchEl.copy.style.display = 'none';
    }
}
benchEl.btn?.addEventListener('click', () => {
    if (!benchEl.panel) return;
    const open = benchEl.panel.classList.toggle('hidden');
    if (!open) { renderBench(); setTimeout(renderBench, 2000); } // hardware fills async → refresh once
});
benchEl.close?.addEventListener('click', () => benchEl.panel?.classList.add('hidden'));
benchEl.run?.addEventListener('click', async () => {
    if (!B()) return;
    benchEl.run.disabled = true;
    benchEl.run.textContent = '测速中...';
    benchEl.result.innerHTML = '<span class="sugg-note">正在向模型发送 3 次测试生成请求…</span>';
    const r = await B().benchmark();
    if (r?.error) { benchEl.result.innerHTML = `<span class="bench-err">测速失败: ${r.error}</span>`; }
    else { await renderBench(); }
    benchEl.run.disabled = false;
    benchEl.run.textContent = '重新测速';
});
benchEl.copy?.addEventListener('click', async () => {
    const st = await B().status();
    const sg = st?.suggestion;
    if (!sg) return;
    const text = `建议上下文长度: ${fmtNum(sg.suggestCtx)}\n建议最大回复长度: ${fmtNum(sg.suggestResp)}`;
    try { await navigator.clipboard.writeText(text); benchEl.copy.textContent = '已复制 ✓'; setTimeout(() => benchEl.copy.textContent = '复制建议', 1500); } catch (_) {}
});
benchEl.reset?.addEventListener('click', async () => { await B()?.reset(); benchEl.result.innerHTML = ''; await renderBench(); });

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
function setDetail(el, html) { if (el) el.innerHTML = html; }
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
    if (pg) setNote(tEl.pin, pg.hasPin ? '已设置' : '');
    const s = await window.electronAPI?.settings?.get?.();
    if (s) tEl.notify.value = s.notifyGenerated === false ? '0' : '1';
    // 回滚列表
    const rl = await TL().rollbackList();
    setNote(tEl.rollbackInfo, rl.length ? `可用 ${rl.length} 个回滚包` : '无回滚包');
    setDetail(tEl.rollbackList, rl.length ? rl.map(r => `<button class="btn-secondary" style="padding:2px 8px;font-size:11px;margin:2px" data-rollback="${r.version}">回滚到 v${r.version}</button>`).join('') : '');
    tEl.rollbackList.querySelectorAll('[data-rollback]').forEach(b => b.addEventListener('click', async () => {
        if (confirm(`确定回滚到 v${b.dataset.rollback}？应用将退出并安装旧版。`)) {
            await TL().rollbackInstall(b.dataset.rollback);
        }
    }));
}
tEl.btn?.addEventListener('click', () => {
    if (!tEl.panel) return;
    const open = tEl.panel.classList.toggle('hidden');
    if (!open) { renderTools(); }
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
    setDetail(tEl.searchRes, `找到 ${res.length} 条${r.truncated ? '（已截断）' : ''}（扫描 ${r.totalFiles} 个文件）：\n` +
        res.map(h => `<span class="hit">[${h.char}] ${h.name}: ${h.snippet.replace(/</g, '&lt;')}</span>`).join(''));
}
tEl.searchKw?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
// 统计
tEl.stats?.addEventListener('click', async () => {
    const s = await TL()?.chatStats();
    if (!s) return;
    setNote(tEl.statsRes, `✅ ${s.chars} 个角色卡 / ${s.totalMessages} 条消息 / ${Math.round(s.totalChars / 10000) / 100} 万字（回复 ${s.replyChars} 字符）`);
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
    setDetail(tEl.envRes, `Ollama 在线，${r.models.length} 个模型：\n` + r.models.map(m =>
        `${loaded.has(m.name) ? '🟢' : '⚪'} ${m.name} (${m.sizeGB}GB ${m.params} ${m.quant})` +
        `<br><button class="btn-secondary" style="padding:1px 6px;font-size:10px" data-oa="load|${m.name}">加载</button>` +
        `<button class="btn-secondary" style="padding:1px 6px;font-size:10px" data-oa="unload|${m.name}">卸载</button>`
    ).join('\n'));
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
    setNote(tEl.pin, code ? '✅ PIN 已设置' : '✅ PIN 已清除');
});
tEl.immerse?.addEventListener('click', async () => { await TL()?.immerseSet(); });
tEl.notify?.addEventListener('change', async () => {
    const s = await window.electronAPI?.settings?.get?.() || {};
    s.notifyGenerated = tEl.notify.value === '1';
    await window.electronAPI?.settings?.save?.(s);
});
// 深夜模式监听
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
async function checkShellUpdate(){const s=$('#shell-update-status');if(!s)return;s.textContent='检查中...';s.className='update-status info';const cur=await A?.getShellVersion();const SU=window.electronAPI?.shellUpdate;if(!SU){s.textContent='自动更新不可用';s.className='update-status error';return;}try{const r=await SU.check();const newer=r?.version&&cur&&String(r.version)!==String(cur)&&(String(r.version).localeCompare(String(cur),undefined,{numeric:true})>0);if(r?.hasUpdate&&newer){s.innerHTML=`发现新版本 <b>v${r.version}</b> (当前 v${cur})`;s.className='update-status success';let dl=$('#btn-dl-shell');if(!dl){dl=document.createElement('button');dl.id='btn-dl-shell';dl.className='btn-primary';dl.style.marginTop='6px';dl.textContent='下载并安装';dl.addEventListener('click',async()=>{if(dl.dataset.done)return;dl.disabled=true;dl.textContent='下载中...';s.innerHTML='下载中...';s.className='update-status info';const sp=$('#shell-update-progress'),sf=$('#shell-progress-fill'),st=$('#shell-progress-text');if(sp){sp.classList.remove('hidden');if(sf)sf.style.width='0%';if(st)st.textContent='0%';}let cleanup=SU.onProgress(({percent})=>{if(sf)sf.style.width=`${Math.round(percent||0)}%`;if(st)st.textContent=`${Math.round(percent||0)}%`;dl.textContent=`下载中 ${Math.round(percent||0)}%`;});let dc=SU.onDownloaded(()=>{cleanup();dc();if(sp)sp.classList.add('hidden');dl.dataset.done='1';s.innerHTML='✅ 下载完成，正在安装...';s.className='update-status success';dl.textContent='安装中...';setTimeout(()=>SU.install(),800);});let ec=SU.onError(e=>{cleanup();dc();ec();if(sp)sp.classList.add('hidden');delete dl.dataset.done;s.textContent='下载失败: '+e;s.className='update-status error';dl.disabled=false;dl.textContent='重试';});try{await SU.download();}catch(e){cleanup();dc();ec();if(sp)sp.classList.add('hidden');delete dl.dataset.done;s.textContent='下载失败: '+e;s.className='update-status error';dl.disabled=false;dl.textContent='重试';}});s.appendChild(dl);}}else if(r?.error){s.textContent=(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|network|Network/i.test(r.error))?'⚠ 网络连接失败 — 请检查网络或代理 (127.0.0.1:7890)':'检查失败: '+r.error;s.className='update-status error';}else{s.textContent='已是最新版本 (v'+cur+')';s.className='update-status info';}}catch(e){s.textContent='检查失败: '+e.message;s.className='update-status error';}}