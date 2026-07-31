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
S?.onError(msg=>{if(loading){loading.classList.remove('hidden');const t=loading.querySelector('.loading-text');if(t)t.textContent='启动失败';if(loadingLog){loadingLog.textContent=msg;loadingLog.classList.add('show');}}});
S?.onSetupStarted?.(()=>{const t=loading?.querySelector('.loading-text');if(t)t.textContent='首次启动 — 正在安装 SillyTavern...';if(loadingLog){loadingLog.classList.add('show');loadingLog.scrollTop=loadingLog.scrollHeight;}});
webview?.addEventListener('dom-ready',()=>{loading?.classList.add('hidden');webview.classList.remove('hidden');webview.focus();});
webview?.addEventListener('will-navigate',e=>{try{if(new URL(e.url).origin!==new URL(webview.src).origin)e.preventDefault();}catch(_){}});
webview?.addEventListener('new-window',e=>e.preventDefault());

// ── Terminal ─────────────────────────────────
let termOpen=false,termHistory='';
function toggleTerminal(){termOpen=!termOpen;termPanel.classList.toggle('hidden',!termOpen);btnTerm.classList.toggle('active',termOpen);if(termOpen){termInput?.focus();if(!termHistory)loadTermHistory();}else updateWebviewSize();}
function updateWebviewSize(){if(!webview)return;const b=termOpen?272:0;webview.style.bottom=b+'px';webview.style.height=`calc(100% - 38px - ${b}px)`;}
async function loadTermHistory(){termHistory=(await T?.getHistory())||'';renderTermOutput(termHistory);}
function renderTermOutput(text){if(!termOut)return;const c=text.replace(/\x1b\[\d+m/g,'');termOut.innerHTML+=('<div>'+c.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</div>');termOut.scrollTop=termOut.scrollHeight;termHistory+=text;}

btnTerm?.addEventListener('click',toggleTerminal);
$('#btn-terminal-close')?.addEventListener('click',toggleTerminal);
$('#btn-terminal-copy')?.addEventListener('click',async()=>{const t=termOut?.innerText||'';await navigator.clipboard.writeText(t);const b=$('#btn-terminal-copy');if(b){b.textContent='✅';setTimeout(()=>{b.textContent='📋';},1000);}});
termOut?.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='c'){const s=window.getSelection()?.toString();if(s){e.preventDefault();navigator.clipboard.writeText(s);}}});
termInput?.addEventListener('keydown',async e=>{if(e.key!=='Enter'||!termInput.value.trim())return;const cmd=termInput.value.trim();termInput.value='';termInput.disabled=true;renderTermOutput(`> ${cmd}\n`);try{const r=await T?.exec(cmd);if(r.stdout)renderTermOutput(r.stdout);if(r.stderr)renderTermOutput(r.stderr);if(r.error)renderTermOutput(`Error: ${r.error}\n`);}catch(err){renderTermOutput(`${err.message}\n`);}termInput.disabled=false;termInput.focus();});

T?.onOutput(text=>{if(!serverReady&&loadingLog){loadingLog.classList.add('show');loadingLog.textContent+=text;loadingLog.scrollTop=loadingLog.scrollHeight;}if(termOpen)renderTermOutput(text);else termHistory+=text;});
(async()=>{const h=await T?.getHistory();if(h&&!serverReady&&loadingLog){loadingLog.classList.add('show');loadingLog.textContent=h;loadingLog.scrollTop=loadingLog.scrollHeight;}termHistory=h||'';})();

// ── Settings ─────────────────────────────────
let settingsData={};
async function openSettings(){settingsOverlay.classList.remove('hidden');settingsData=(await ST?.get())||{};const v=await A?.getVersion();$('#setting-server-path').value=settingsData.serverPath||'';$('#setting-width').value=settingsData.windowWidth||1280;$('#setting-height').value=settingsData.windowHeight||800;$('#setting-shell-repo').value=settingsData.shellUpdateRepo||'';const cs=$('#setting-close-behavior');if(cs)cs.value=settingsData.closeBehavior||'ask';if($('#version-display'))$('#version-display').textContent=v||'unknown';const s=$('#update-status');if(s)s.textContent=s.className='';$('#btn-do-update')?.remove();$('#btn-view-update')?.remove();const p=$('#update-progress');if(p)p.classList.add('hidden');const ss=$('#shell-update-status');if(ss)ss.textContent=ss.className='';$('#btn-dl-shell')?.remove();}
function closeSettings(){settingsOverlay.classList.add('hidden');}
btnSettings?.addEventListener('click',openSettings);
$('#btn-settings-close')?.addEventListener('click',closeSettings);
$('#btn-settings-cancel')?.addEventListener('click',closeSettings);
settingsOverlay?.addEventListener('click',e=>{if(e.target===settingsOverlay)closeSettings();});
$('#btn-settings-save')?.addEventListener('click',async()=>{const sp=$('#setting-server-path').value.trim();const w=parseInt($('#setting-width').value)||1280;const h=parseInt($('#setting-height').value)||800;const cb=$('#setting-close-behavior')?.value||'ask';const sr=$('#setting-shell-repo')?.value.trim()||'';await ST?.save({serverPath:sp,windowWidth:w,windowHeight:h,closeBehavior:cb,shellUpdateRepo:sr});closeSettings();});
$('#btn-shell-changelog')?.addEventListener('click',async()=>{const md=await A?.getChangelog();const html=md.replace(/^# (.+)/gm,'<h3>$1</h3>').replace(/^## (.+)/gm,'<h4>$1</h4>').replace(/^- (.+)/gm,'<li>$1</li>').replace(/(<li>.*<\/li>)/gs,'<ul>$1</ul>');const el=document.createElement('div');el.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:999;display:flex;align-items:center;justify-content:center';el.innerHTML=`<div style=\"background:rgba(18,18,42,0.95);backdrop-filter:blur(20px);border-radius:12px;padding:20px;max-width:500px;max-height:80vh;overflow-y:auto;color:#c8c8d4;font-size:13px;line-height:1.6\"><div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:12px\"><h3 style=\"margin:0;color:#7c5cbf\">套壳更新日志</h3><button style=\"background:none;border:none;color:#c8c8d4;font-size:18px;cursor:pointer\">&times;</button></div>${html}</div>`;el.querySelector('button').onclick=()=>el.remove();el.onclick=e=>{if(e.target===el)el.remove();};document.body.appendChild(el);});

// ── Update ───────────────────────────────────
let updateData=null,updateCleanup=null;
$('#btn-check-update')?.addEventListener('click',checkUpdate);
$('#btn-update')?.addEventListener('click',async()=>{openSettings();checkUpdate();});
async function checkUpdate(){const b=$('#btn-check-update'),s=$('#update-status');if(b)b.disabled=true;if(s){s.textContent='检查中...';s.className='update-status info';}updateData=await U?.check();if(updateData?.error){if(s){s.textContent='检查失败: '+updateData.error;s.className='update-status error';}}else if(updateData?.hasUpdate){if(s){s.innerHTML=`发现新版本 <b>v${updateData.latest}</b> (当前 v${updateData.current})`;s.className='update-status success';}let ub=$('#btn-do-update');if(!ub){ub=document.createElement('button');ub.id='btn-do-update';ub.className='btn-primary';ub.textContent='立即更新';ub.addEventListener('click',doUpdate);$('.update-section').appendChild(ub);}let vu=$('#btn-view-update');if(!vu&&updateData?.url){vu=document.createElement('button');vu.id='btn-view-update';vu.className='btn-secondary';vu.textContent='查看更新日志';vu.style.marginTop='6px';vu.addEventListener('click',()=>{window.open(updateData.url,'_blank');});$('.update-section').appendChild(vu);}}else{if(s){s.textContent='已是最新版本 (v'+updateData.current+')';s.className='update-status info';}}if(b)b.disabled=false;}
async function doUpdate(){const s=$('#update-status'),p=$('#update-progress');$('#btn-do-update').disabled=true;$('#btn-check-update').disabled=true;s.textContent='更新中 (git pull + npm install)...';s.className='update-status info';p.classList.remove('hidden');$('#progress-fill').style.width='100%';$('#progress-text').textContent='更新完成后服务器将自动重启';try{const r=await U?.updateSillyTavern();if(r?.success){s.textContent='更新完成！';s.className='update-status success';p.classList.add('hidden');}else throw new Error(r?.error||'Update failed');}catch(e){s.textContent='更新失败: '+e.message;s.className='update-status error';p.classList.add('hidden');}}

document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='`'){e.preventDefault();toggleTerminal();}});
$('#btn-refresh')?.addEventListener('click',()=>{webview?.reload();});
$('#btn-toggle-fabs')?.addEventListener('click',()=>{$('#float-buttons').classList.toggle('collapsed');});

// Integrity check
$('#btn-check-integrity')?.addEventListener('click',async()=>{const s=$('#integrity-status');if(!s)return;s.textContent='检测中...';s.className='update-status info';try{const r1=await T?.exec("git ls-files --deleted 2>nul");const r2=await T?.exec("node -e \"console.log(require('fs').existsSync('node_modules')?'✅ node_modules':'❌ node_modules (缺失)')\"");const lines=[];if(r1?.stdout)r1.stdout.trim().split('\n').filter(l=>l&&!l.startsWith('data/')).forEach(l=>lines.push('❌ '+l));if(r2?.stdout)lines.push(r2.stdout.trim());if(lines.length===0){s.textContent='✅ 所有文件完整 (已排除 data/default-user)';s.className='update-status success';}else{s.innerHTML='<pre style=margin:0;font-size:11px;line-height:1.6;max-height:200px;overflow-y:auto>缺失/异常文件：\n'+lines.join('\n')+'</pre>';s.className='update-status error';}}catch(e){s.textContent='检测失败: '+e.message;s.className='update-status error';}});

// Ctrl+Scroll zoom
// Ctrl+Scroll zoom — bind to webview content
let zoomLevel=0;
webview?.addEventListener('dom-ready',()=>{webview?.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();zoomLevel=Math.min(2,Math.max(-3,zoomLevel+(e.deltaY>0?-0.2:0.2)));webview?.setZoomLevel(zoomLevel);}},{passive:false});});
$('#btn-check-shell-update')?.addEventListener('click',async()=>{const s=$('#shell-update-status');if(!s)return;s.textContent='检查中...';s.className='update-status info';const cur=await A?.getShellVersion();const SU=window.electronAPI?.shellUpdate;if(!SU){s.textContent='自动更新不可用';s.className='update-status error';return;}try{const r=await SU.check();if(r?.hasUpdate){s.innerHTML=`发现新版本 <b>v${r.version}</b> (当前 v${cur})`;s.className='update-status success';let dl=$('#btn-dl-shell');if(!dl){dl=document.createElement('button');dl.id='btn-dl-shell';dl.className='btn-primary';dl.style.marginTop='6px';dl.textContent='下载并安装';dl.addEventListener('click',async()=>{dl.disabled=true;dl.textContent='下载中...';s.innerHTML='下载中...';s.className='update-status info';let cleanup=SU.onProgress(({percent})=>{dl.textContent=`下载中 ${Math.round(percent)}%`;});let dc=SU.onDownloaded(()=>{cleanup();dc();s.innerHTML='更新已下载！下次启动自动安装。';s.className='update-status success';dl.textContent='已就绪';});try{await SU.download();}catch(e){cleanup();dc();s.textContent='下载失败: '+e.message;s.className='update-status error';dl.disabled=false;dl.textContent='重试';}});s.appendChild(dl);}}else{s.textContent='已是最新版本 (v'+cur+')';s.className='update-status info';}}catch(e){s.textContent='检查失败: '+e.message;s.className='update-status error';}});
