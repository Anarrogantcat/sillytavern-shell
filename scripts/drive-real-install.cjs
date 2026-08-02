// Drive the REAL installed v1.6.5 app: open settings → check shell update → download → watch UI
const CDP_BASE = 'http://127.0.0.1:9223';
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
    if (!t) { console.log('FAIL: no shell page target, got:', targets.map(x => x.url).join(' | ')); process.exit(1); }
    const cdp = await connect(t.webSocketDebuggerUrl);
    console.log('connected to:', t.url);

    // open settings (auto-triggers checkShellUpdate)
    await evl(cdp, `document.getElementById('btn-settings')?.click(); true`);
    await sleep(3000);
    const state1 = await evl(cdp, `JSON.stringify({
        status: document.getElementById('shell-update-status')?.textContent,
        btn: document.getElementById('btn-dl-shell')?.textContent || 'NO-BTN'
    })`);
    console.log('after open settings:', state1);

    // if update available → click download
    const hasBtn = await evl(cdp, `!!document.getElementById('btn-dl-shell')`);
    if (hasBtn) {
        console.log('>>> clicking 下载并安装');
        await evl(cdp, `document.getElementById('btn-dl-shell').click(); true`);
        // poll UI every 2s
        for (let i = 0; i < 30; i++) {
            await sleep(2000);
            const st = await evl(cdp, `JSON.stringify({
                status: document.getElementById('shell-update-status')?.textContent,
                btn: document.getElementById('btn-dl-shell')?.textContent || 'NO-BTN',
                progressHidden: document.getElementById('shell-update-progress')?.classList.contains('hidden'),
                progressText: document.getElementById('shell-progress-text')?.textContent
            })`);
            console.log(`t+${(i+1)*2}s:`, st);
            const parsed = JSON.parse(st);
            if (/安装并重启|更新已下载/.test(parsed.status + ' ' + parsed.btn) || /下载失败/.test(parsed.status)) { break; }
        }
    } else {
        console.log('no update button — status was:', state1);
    }
    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
