// Test terminal drag-resize with REAL mouse events (Input.dispatchMouseEvent)
// Launch: electron . --server-path <repo>\.smoke\SillyTavern --remote-debugging-port=9222
//   (use --user-data-dir=... to avoid the single-instance lock when the real app is running)
const CDP_BASE = 'http://127.0.0.1:9222';
async function getTargets() { return (await fetch(CDP_BASE + '/json/list')).json(); }
function connect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0; const pending = new Map();
        ws.onopen = () => resolve({
            send(method, params = {}) {
                return new Promise((res, rej) => {
                    const msgId = ++id;
                    pending.set(msgId, { res, rej });
                    ws.send(JSON.stringify({ id: msgId, method, params }));
                });
            },
            close() { ws.close(); }
        });
        ws.onerror = e => reject(new Error('WS error: ' + e.message));
        ws.onmessage = ev => {
            const msg = JSON.parse(ev.data);
            if (msg.id && pending.has(msg.id)) {
                const { res, rej } = pending.get(msg.id);
                pending.delete(msg.id);
                msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
            }
        };
    });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evl(cdp, expression, awaitPromise = false) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
}
async function main() {
    const targets = await getTargets();
    const t = targets.find(x => x.type === 'page' && /shell\.html/.test(x.url));
    if (!t) { console.log('FAIL: no shell page'); process.exit(1); }
    const cdp = await connect(t.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 1. Open terminal
    await evl(cdp, `document.getElementById('btn-terminal')?.click(); true`);
    await sleep(400);
    const before = await evl(cdp, `JSON.stringify({
        panelH: document.getElementById('terminal-panel').getBoundingClientRect().height,
        handle: (()=>{const r=document.getElementById('term-resize-handle')?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,w:r.width,h:r.height}:null;})(),
        termHeight: window.termHeight
    })`);
    console.log('BEFORE:', before);

    // 2. Real mouse drag: press on handle center, move down 120px, release
    const h = JSON.parse(before).handle;
    if (!h) { console.log('FAIL: no handle rect'); process.exit(1); }
    const x = Math.round((h.left + h.right) / 2);
    const y0 = Math.round((h.top + h.bottom) / 2);
    console.log('handle center:', x, y0);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: y0, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(100);
    // move down in steps
    for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y0 + i * 20, button: 'left', buttons: 1 });
        await sleep(60);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y0 + 120, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);

    const after = await evl(cdp, `JSON.stringify({
        panelH: document.getElementById('terminal-panel').getBoundingClientRect().height,
        termHeight: window.termHeight,
        webviewBottom: document.getElementById('sillytavern-webview').style.bottom,
        stored: localStorage.getItem('termHeight')
    })`);
    console.log('AFTER:', after);

    // 3. Close & reopen terminal — persisted height should apply
    await evl(cdp, `document.getElementById('btn-terminal-close')?.click(); true`);
    await sleep(300);
    await evl(cdp, `document.getElementById('btn-terminal')?.click(); true`);
    await sleep(400);
    const reopened = await evl(cdp, `JSON.stringify({
        panelH: document.getElementById('terminal-panel').getBoundingClientRect().height,
        termHeight: window.termHeight
    })`);
    console.log('REOPENED:', reopened);

    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
