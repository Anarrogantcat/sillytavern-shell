// Reusable GUI smoke test for SillyTavern Shell.
// Usage: launch app with --remote-debugging-port=9222 --server-path <fake-st>, then:
//   node scripts/smoke-test.cjs
// Verifies: page state, zoom (setZoomFactor + keyboard + webview wheel chain), terminal flood.
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
async function evl(cdp, expression, awaitPromise = false) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
}
let failures = 0;
function check(name, cond, detail) {
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail !== undefined ? ' | ' + detail : ''));
    if (!cond) failures++;
}
async function main() {
    const targets = await getTargets();
    const shellT = targets.find(x => x.type === 'page' && /shell\.html/.test(x.url));
    const wvT = targets.find(x => x.type === 'webview' || (x.type === 'page' && /^http:\/\//.test(x.url)));
    if (!shellT) { console.log('FAIL | no shell page target'); process.exit(1); }
    const shell = await connect(shellT.webSocketDebuggerUrl);
    const wv = wvT ? await connect(wvT.webSocketDebuggerUrl) : null;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    check('page loaded', await evl(shell, `document.title`) === 'SillyTavern');
    check('electronAPI exposed', await evl(shell, `!!window.electronAPI`) === true);
    check('webview present', await evl(shell, `!!document.querySelector('webview')`) === true);
    const vis = await evl(shell, `JSON.stringify({hidden:document.hidden,state:document.visibilityState})`);
    console.log('NOTE | visibility:', vis, '(hidden=true → setTimeout throttled to 1s by Chromium, ignore timing asserts)');

    // server URL pushed (race-condition regression check)
    const src = await evl(shell, `document.querySelector('webview')?.src || ''`);
    check('webview has server URL', /^http:\/\//.test(src), src);

    // zoom API roundtrip (reset first — previous run may have left a factor)
    const zoom = await evl(shell, `(async()=>{const w=document.querySelector('webview');await w.setZoomFactor(1);const b=await w.getZoomFactor();await w.setZoomFactor(1.5);const a=await w.getZoomFactor();await w.setZoomFactor(b);return JSON.stringify({b,a});})()`, true);
    const z = JSON.parse(zoom || '{}');
    check('setZoomFactor roundtrip', z.b === 1 && z.a === 1.5, zoom);

    // keyboard zoom (reset via real Ctrl+0 so shell zoomFactor var stays in sync)
    const kb = await evl(shell, `(async()=>{const w=document.querySelector('webview');document.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,150));const b=await w.getZoomFactor();document.dispatchEvent(new KeyboardEvent('keydown',{key:'=',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,150));const a=await w.getZoomFactor();document.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,150));return JSON.stringify({b,a,r:await w.getZoomFactor()});})()`, true);
    const k = JSON.parse(kb || '{}');
    check('Ctrl+= zooms in (1→1.1)', k.b === 1 && Math.abs(k.a - 1.1) < 0.01, kb);
    check('Ctrl+0 resets (→1)', k.r === 1, kb);

    // webview wheel → preload → ipc → zoom chain
    if (wv) {
        const before = await evl(shell, `document.querySelector('webview').getZoomFactor()`, true);
        const dispatched = await evl(wv, `(()=>{const r=[];for(let i=0;i<3;i++)r.push(window.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:120,bubbles:true,cancelable:true})));return JSON.stringify(r);})()`);
        await sleep(600);
        const after = await evl(shell, `document.querySelector('webview').getZoomFactor()`, true);
        check('preventDefault called', (JSON.parse(dispatched || '[]')).every(v => v === false), dispatched);
        check('ctrl+wheel zooms out (1→0.9, 80ms coalesced)', before === 1 && Math.abs(after - 0.9) < 0.01, `before=${before} after=${after}`);
    } else {
        console.log('SKIP | webview wheel chain (no webview target)');
    }

    // terminal flood (direct API, no visible window needed)
    const term = await evl(shell, `(async()=>{document.getElementById('btn-terminal')?.click();await new Promise(r=>setTimeout(r,100));const out=document.getElementById('terminal-output');const t0=performance.now();for(let i=0;i<2000;i++)termAppend('line '+i+' \\x1b[31mred\\x1b[0m\\n');await new Promise(r=>setTimeout(r,500));return JSON.stringify({nodes:out.childElementCount,hist:termHistory.length,ms:Math.round(performance.now()-t0),last:out.lastChild?out.lastChild.textContent.slice(-20):''});})()`, true);
    const tm = JSON.parse(term || '{}');
    check('terminal nodes capped ≤800', tm.nodes <= 800, term);
    check('history capped ≤2MB', tm.hist <= 2 * 1024 * 1024, term);
    check('ANSI stripped (no ESC in output)', !/\x1b/.test(tm.last || ''), JSON.stringify(tm.last));
    await evl(shell, `document.getElementById('btn-terminal-close')?.click(); true`);

    shell.close(); if (wv) wv.close();
    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
