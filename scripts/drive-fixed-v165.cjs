// Drive FIXED local v1.6.5: open settings → check shell update → verify no EPIPE crash + shows v1.6.7
const CDP_BASE = 'http://127.0.0.1:9225';
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
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
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
    console.log('connected:', t.url);

    // open settings (auto checkShellUpdate)
    await evl(cdp, `document.getElementById('btn-settings')?.click(); true`);
    // poll status up to 30s (github check can take a few seconds)
    let finalStatus = '';
    for (let i = 0; i < 15; i++) {
        await sleep(2000);
        finalStatus = await evl(cdp, `document.getElementById('shell-update-status')?.textContent || ''`);
        console.log(`t+${(i+1)*2}s:`, finalStatus);
        if (!/检查中/.test(finalStatus)) break;
    }
    // app alive?
    const alive = await evl(cdp, `!!document.getElementById('btn-settings')`);
    console.log('app alive after check:', alive);

    // is there a download button (update found)?
    const hasBtn = await evl(cdp, `!!document.getElementById('btn-dl-shell')`);
    console.log('下载并安装 button:', hasBtn);

    // check updater logs in terminal
    await evl(cdp, `document.getElementById('btn-terminal')?.click(); true`);
    await sleep(600);
    const termText = await evl(cdp, `document.getElementById('terminal-output')?.innerText || ''`);
    const updaterLogs = (termText.match(/\[updater\]/g) || []).length;
    console.log('[updater] log lines:', updaterLogs);
    if (updaterLogs) console.log(termText.split('\n').filter(l => l.includes('[updater]')).slice(0, 4).join('\n'));

    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
