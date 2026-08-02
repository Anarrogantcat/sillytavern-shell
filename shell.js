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
const TERM_HEIGHT_MIN=120,TERM_HEIGHT_MAX=600;
let termHeight=(()=>{const v=parseInt(localStorage.getItem('termHeight')||'260',10);return Math.min(TERM_HEIGHT_MAX,Math.max(TERM_HEIGHT_MIN,v));})();
function updateWebviewSize(){
    if(!webview)return;
    if(termPanel)termPanel.style.height=termHeight+'px';
    const b=termOpen?termHeight+12:0;
    webview.style.bottom=b+'px';
    webview.style.height=`calc(100% - 38px - ${b}px)`;
}
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
        termHeight=Math.min(TERM_HEIGHT_MAX,Math.max(TERM_HEIGHT_MIN,startH+dh));
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
async function openSettings(){settingsOverlay.classList.remove('hidden');settingsData=(await ST?.get())||{};const v=await A?.getVersion();$('#setting-server-path').value=settingsData.serverPath||'';$('#setting-data-root').value=(await ST?.getDataRoot())||'';$('#setting-width').value=settingsData.windowWidth||1280;$('#setting-height').value=settingsData.windowHeight||800;const cs=$('#setting-close-behavior');if(cs)cs.value=settingsData.closeBehavior||'ask';if($('#version-display'))$('#version-display').textContent=v||'unknown';if($('#shell-version-display'))$('#shell-version-display').textContent='v'+(await A?.getShellVersion()||'?');const sc=$('#server-ctl-status');if(sc)sc.textContent=sc.className='';const s=$('#update-status');if(s)s.textContent=s.className='';$('#btn-do-update')?.remove();$('#btn-view-update')?.remove();const p=$('#update-progress');if(p)p.classList.add('hidden');const ss=$('#shell-update-status');if(ss)ss.textContent=ss.className='';$('#btn-dl-shell')?.remove();checkShellUpdate();}
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
const script=`const fs=require('fs');const git=require('child_process').execSync('git rev-parse --is-inside-work-tree',{stdio:'pipe'}).toString().trim()==='true';const out=[];if(git){const del=require('child_process').execSync('git ls-files --deleted',{stdio:'pipe'}).toString().trim().split('\\n').filter(l=>l&&!l.startsWith('data/'));del.forEach(l=>out.push('MISSING '+l));}else{['server.js','package.json','public/index.html'].forEach(f=>{if(!fs.existsSync(f))out.push('MISSING '+f);});}if(!fs.existsSync('node_modules'))out.push('MISSING node_modules');console.log(JSON.stringify({git,out}));`;
const r=await T?.exec('node -e "'+script.replace(/"/g,'\\"')+'"');
if(r?.error&&!r.stdout){s.textContent='检测失败: '+(r.stderr||r.error);s.className='update-status error';return;}
let data={git:false,out:[]};try{data=JSON.parse(r?.stdout||'{}');}catch(_){}
if(data.out.length===0){s.textContent=data.git?'✅ 所有文件完整 (git 安装)':'✅ 核心文件完整 (非 git 安装)';s.className='update-status success';}
else{s.innerHTML='<pre style=margin:0;font-size:11px;line-height:1.6;max-height:200px;overflow-y:auto>缺失文件：\\n'+data.out.join('\\n')+'</pre>';s.className='update-status error';}
}catch(e){s.textContent='检测失败: '+e.message;s.className='update-status error';}});

// Ctrl+Scroll zoom — now handled via webview preload + setZoomFactor (see Zoom section above)

$('#btn-check-shell-update')?.addEventListener('click',checkShellUpdate);
async function checkShellUpdate(){const s=$('#shell-update-status');if(!s)return;s.textContent='检查中...';s.className='update-status info';const cur=await A?.getShellVersion();const SU=window.electronAPI?.shellUpdate;if(!SU){s.textContent='自动更新不可用';s.className='update-status error';return;}try{const r=await SU.check();const newer=r?.version&&cur&&String(r.version)!==String(cur)&&(String(r.version).localeCompare(String(cur),undefined,{numeric:true})>0);if(r?.hasUpdate&&newer){s.innerHTML=`发现新版本 <b>v${r.version}</b> (当前 v${cur})`;s.className='update-status success';let dl=$('#btn-dl-shell');if(!dl){dl=document.createElement('button');dl.id='btn-dl-shell';dl.className='btn-primary';dl.style.marginTop='6px';dl.textContent='下载并安装';dl.addEventListener('click',async()=>{dl.disabled=true;dl.textContent='下载中...';s.innerHTML='下载中...';s.className='update-status info';const sp=$('#shell-update-progress'),sf=$('#shell-progress-fill'),st=$('#shell-progress-text');if(sp){sp.classList.remove('hidden');if(sf)sf.style.width='0%';if(st)st.textContent='0%';}let cleanup=SU.onProgress(({percent})=>{if(sf)sf.style.width=`${Math.round(percent||0)}%`;if(st)st.textContent=`${Math.round(percent||0)}%`;dl.textContent=`下载中 ${Math.round(percent||0)}%`;});let dc=SU.onDownloaded(()=>{cleanup();dc();if(sp)sp.classList.add('hidden');s.innerHTML='✅ 更新已下载！';s.className='update-status success';dl.textContent='安装并重启';dl.disabled=false;dl.addEventListener('click',()=>SU.install(),{once:true});});let ec=SU.onError(e=>{cleanup();dc();ec();if(sp)sp.classList.add('hidden');s.textContent='下载失败: '+e;s.className='update-status error';dl.disabled=false;dl.textContent='重试';});try{await SU.download();}catch(e){cleanup();dc();ec();if(sp)sp.classList.add('hidden');s.textContent='下载失败: '+e;s.className='update-status error';dl.disabled=false;dl.textContent='重试';}});s.appendChild(dl);}}else if(r?.error){s.textContent=(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|network|Network/i.test(r.error))?'⚠ 网络连接失败 — 请检查网络或代理 (127.0.0.1:7890)':'检查失败: '+r.error;s.className='update-status error';}else{s.textContent='已是最新版本 (v'+cur+')';s.className='update-status info';}}catch(e){s.textContent='检查失败: '+e.message;s.className='update-status error';}}