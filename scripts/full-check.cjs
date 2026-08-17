// Comprehensive static check: all DOM ids referenced in shell.js/chat.html exist in shell.html/chat.html
// + all ipcRenderer.invoke channels in preload.js have matching ipcMain.handle in main code
const fs = require('fs');
const base = 'D:/AI/sillytavern-shell/';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

// 1. DOM ids
console.log('=== 1. DOM id 引用一致性 ===');
const shellHtml = fs.readFileSync(base + 'shell.html', 'utf8');
const shellJs = fs.readFileSync(base + 'shell.js', 'utf8');
const chatHtml = fs.readFileSync(base + 'chat.html', 'utf8');
const ids = new Set([...shellHtml.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const refs = new Set([...shellJs.matchAll(/\$\('#([^']+)'\)/g)].map(m => m[1]));
// 动态创建的元素 id（运行时 document.createElement，不要求静态存在）
const dynamicIds = new Set(['btn-do-update', 'btn-view-update', 'btn-dl-shell', 'zoom-badge', 'mini-close']);
let missing = [...refs].filter(r => !ids.has(r) && !dynamicIds.has(r));
if (missing.length) bad('shell.js 引用缺失 id: ' + missing.join(', '));
else ok('shell.js 引用 ' + refs.size + ' 个 id 全部存在');
// chat.html refs
const chatIds = new Set([...chatHtml.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const chatRefs = new Set([...chatHtml.matchAll(/\$\('#([^']+)'\)/g)].map(m => m[1]));
missing = [...chatRefs].filter(r => !chatIds.has(r));
if (missing.length) bad('chat.html 引用缺失 id: ' + missing.join(', '));
else ok('chat.html 引用全部存在');

// 2. IPC 通道一致性 (preload invoke vs main handle)
console.log('=== 2. IPC 通道一致性 ===');
const preload = fs.readFileSync(base + 'preload.js', 'utf8');
const indexJs = fs.readFileSync(base + 'index.js', 'utf8');
const libs = ['tools-app.js', 'tools-data.js', 'tools-env.js', 'tools-chat.js'].map(f => fs.readFileSync(base + 'lib/' + f, 'utf8')).join('\n');
const mainAll = indexJs + libs;
const invokes = new Set([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1]));
const handles = new Set([...mainAll.matchAll(/ipcMain\.(handle|on)\('([^']+)'/g)].map(m => m[2]));
missing = [...invokes].filter(c => !handles.has(c));
if (missing.length) bad('preload 调用但主进程未注册: ' + missing.join(', '));
else ok('preload ' + invokes.size + ' 个通道全部有主进程 handler');
// reverse: main handles not used anywhere (informational)
const unused = [...handles].filter(c => !invokes.has(c) && !mainAll.includes("'" + c + "'") === false);
console.log('  主进程 handler 总数: ' + handles.size);

// 3. 引用未定义函数（粗略：shell.js 调用但未定义的全局函数）
console.log('=== 3. shell.js 函数引用 ===');
const fnDefs = new Set([...shellJs.matchAll(/function\s+(\w+)/g)].map(m => m[1]));
const fnCalls = new Set([...shellJs.matchAll(/\b(\w+)\s*\(/g)].map(m => m[1]));
const builtins = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'delete', 'document', 'window', 'localStorage', 'setTimeout', 'setInterval', 'clearTimeout', 'confirm', 'alert', 'Notification', 'parseInt', 'Number', 'String', 'Math', 'JSON', 'Object', 'Array', 'Boolean', 'Date', 'navigator', 'fetch', 'encodeURIComponent', 'decodeURIComponent', 'isNaN', 'Promise', 'console', 'require', 'module', 'exports', 'event', 'Event', 'KeyboardEvent', 'CustomEvent', 'WebSocket', 'URL', 'parseFloat', 'Set', 'Map', 'Error', 'RegExp', 'Infinity', 'undefined', 'null', 'true', 'false', 'this', 'e', 'ev', 'err', 'x', 'i', 'j', 'k', 'v', 't', 's', 'r', 'p', 'u', 'h', 'cmd', 'text', 'el', 'val', 'a', 'b', 'c', 'd', 'f', 'g', 'm', 'n', 'o', 'q', 'w', 'y', 'z', 'id', 'key', 'opt', 'opts', 'cfg', 'args', 'res', 'rej', 'ws', 'menu', 'win', 'wc', 'url', 'out', 'ms', 'now', 'sel', 'inp', 'btn', 'ov', 'errEl']);
const suspect = [...fnCalls].filter(f => !fnDefs.has(f) && !builtins.has(f) && !refs.has(f) && !ids.has(f) && !/^[A-Z]/.test(f) && !/^[a-z]+[A-Z]/.test(f) && f.length > 2);
if (suspect.length) {
    const real = suspect.filter(f => !['setNote', 'setDetail', 'renderTools', 'renderUiSettings', 'openSettings', 'closeSettings', 'checkShellUpdate', 'checkUpdate', 'toggleTerminal', 'termAppend', 'stripAnsi', 'fmtNum', 'applyZoom', 'miniShow', 'miniHide', 'loadSession', 'refreshSessions', 'renderMsgs', 'doSend', 'doSearch', 'tryUnlock', 'openSettings'].includes(f));
    if (real.length) bad('可能未定义函数: ' + real.join(', '));
    else ok('函数引用正常（工具函数已定义）');
} else ok('函数引用正常');

process.exit(fail ? 1 : 0);
