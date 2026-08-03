// Drive the bench panel end-to-end: open panel → check status → run benchmark → verify suggestion
const CDP_BASE = 'http://127.0.0.1:9230';
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
    if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200);
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

    // 1. open bench panel
    await evl(cdp, `document.getElementById('btn-bench')?.click(); true`);
    await sleep(1500);
    const panelOpen = await evl(cdp, `!document.getElementById('bench-panel').classList.contains('hidden')`);
    console.log('panel open:', panelOpen);
    console.log('model:', await evl(cdp, `document.getElementById('bench-model').textContent`));
    console.log('char:', await evl(cdp, `document.getElementById('bench-char').textContent`));
    console.log('hw:', await evl(cdp, `document.getElementById('bench-hw').textContent`));
    console.log('progress:', await evl(cdp, `document.getElementById('bench-progress').textContent`));

    // 2. run benchmark (real Ollama request, can take 30-120s)
    console.log('--- running benchmark (real Ollama) ---');
    await evl(cdp, `document.getElementById('btn-bench-run').click(); true`);
    let result = '';
    for (let i = 0; i < 60; i++) {
        await sleep(3000);
        result = await evl(cdp, `document.getElementById('bench-result').innerText`);
        if (/测速完成|失败/.test(result)) break;
    }
    console.log('result:', result);
    const copyVisible = await evl(cdp, `document.getElementById('btn-bench-copy').style.display !== 'none'`);
    console.log('copy btn visible:', copyVisible);
    if (copyVisible) {
        console.log('suggestion HTML:', await evl(cdp, `document.getElementById('bench-result').innerHTML`));
    }
    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
