// Diagnose terminal drag-resize issues on local v1.6.8
const CDP_BASE = 'http://127.0.0.1:9228';
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
    let targets;
    for (let i = 0; i < 20; i++) {
        try { targets = await getTargets(); if (targets.length) break; } catch (_) {}
        await sleep(1000);
    }
    const t = targets.find(x => x.type === 'page' && /shell\.html/.test(x.url));
    if (!t) { console.log('FAIL: no page'); process.exit(1); }
    const cdp = await connect(t.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    // open terminal
    await evl(cdp, `document.getElementById('btn-terminal')?.click(); true`);
    await sleep(500);

    // state before
    const before = await evl(cdp, `JSON.stringify({
        termHeight: window.termHeight,
        panelRect: (()=>{const r=document.getElementById('terminal-panel').getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:r.height};})(),
        webviewRect: (()=>{const r=document.getElementById('sillytavern-webview').getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:r.height};})(),
        handleRect: (()=>{const r=document.getElementById('term-resize-handle')?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,h:r.height}:null;})()
    })`);
    console.log('BEFORE:', before);

    // simulate drag down 150px with REAL mouse events
    const h = JSON.parse(before).handleRect;
    const x = Math.round((h.left || 640) + 400);
    const y0 = Math.round((h.top + h.bottom) / 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: y0, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y0 + i * 15, button: 'left', buttons: 1 });
        await sleep(40);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y0 + 150, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);

    const after = await evl(cdp, `JSON.stringify({
        termHeight: window.termHeight,
        panelRect: (()=>{const r=document.getElementById('terminal-panel').getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:r.height};})(),
        webviewRect: (()=>{const r=document.getElementById('sillytavern-webview').getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:r.height};})(),
        gap: (()=>{const p=document.getElementById('terminal-panel').getBoundingClientRect();const w=document.getElementById('sillytavern-webview').getBoundingClientRect();return Math.round(p.top - w.bottom);})(),
        overflow: (()=>{const p=document.getElementById('terminal-panel');return {scrollH:p.scrollHeight, clientH:p.clientHeight, overflowY:getComputedStyle(p).overflowY};})(),
        outScroll: (()=>{const o=document.getElementById('terminal-output');return {scrollH:o.scrollHeight, clientH:o.clientHeight, overflowY:getComputedStyle(o).overflowY};})()
    })`);
    console.log('AFTER (drag +150px):', after);

    // drag UP (shrink) beyond min limit
    const h2 = JSON.parse(after).handleRect || h;
    const y0b = Math.round((h2.top + h2.bottom) / 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: y0b, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    for (let i = 1; i <= 15; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y0b - i * 30, button: 'left', buttons: 1 });
        await sleep(30);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y0b - 450, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);

    const afterShrink = await evl(cdp, `JSON.stringify({
        termHeight: window.termHeight,
        panelH: document.getElementById('terminal-panel').getBoundingClientRect().height,
        webviewH: document.getElementById('sillytavern-webview').getBoundingClientRect().height
    })`);
    console.log('AFTER (shrink -450px, should clamp at 120):', afterShrink);

    // check console errors
    const errs = await evl(cdp, `window.__errs ? window.__errs.length : 'no listener'`);
    console.log('console errors captured:', errs);

    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
