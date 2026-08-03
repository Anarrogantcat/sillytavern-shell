// Verify: panel opens instantly (no main-process block), hardware fills async, watcher follows char
const CDP_BASE = 'http://127.0.0.1:9237';
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
async function evl(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, replMode: true, returnByValue: true });
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

    // 1. open panel — measure how fast status IPC returns (must be < 1s, no sync block)
    const t0 = Date.now();
    await evl(cdp, `document.getElementById('btn-bench').click(); true`);
    await sleep(300);
    const st1 = await evl(cdp, `JSON.stringify((await window.electronAPI.bench.status()).hardware)`);
    const elapsed = Date.now() - t0;
    console.log(`panel open + status: ${elapsed}ms (must be fast) | hardware:`, st1);

    // 2. hardware should fill async shortly after
    await sleep(3000);
    const st2 = await evl(cdp, `JSON.stringify((await window.electronAPI.bench.status()).hardware)`);
    console.log('hardware after 3s:', st2);
    const panelHtml = await evl(cdp, `document.getElementById('bench-hw').textContent`);
    console.log('面板硬件显示:', panelHtml);
    console.log('模型:', await evl(cdp, `document.getElementById('bench-model').textContent`));
    console.log('角色卡:', await evl(cdp, `document.getElementById('bench-char').textContent`));

    // 3. panel toggle close/open still works
    await evl(cdp, `document.getElementById('btn-bench-close').click(); true`);
    await sleep(200);
    const closed = await evl(cdp, `document.getElementById('bench-panel').classList.contains('hidden')`);
    console.log('关闭面板后 hidden:', closed);
    await evl(cdp, `document.getElementById('btn-bench').click(); true`);
    await sleep(300);
    console.log('重新打开正常:', await evl(cdp, `!document.getElementById('bench-panel').classList.contains('hidden')`));

    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
