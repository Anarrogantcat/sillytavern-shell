// FULL E2E on FIXED local v1.6.5: check → click download → verify auto-install triggers
// This will actually install v1.6.7 and restart the app!
const CDP_BASE = 'http://127.0.0.1:9226';
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

    // open settings → auto check
    await evl(cdp, `document.getElementById('btn-settings')?.click(); true`);
    let status = '', hasBtn = false;
    for (let i = 0; i < 15; i++) {
        await sleep(2000);
        status = await evl(cdp, `document.getElementById('shell-update-status')?.textContent || ''`);
        hasBtn = await evl(cdp, `!!document.getElementById('btn-dl-shell')`);
        console.log(`t+${(i+1)*2}s: status=${status} btn=${hasBtn}`);
        if (hasBtn) break;
    }
    if (!hasBtn) { console.log('FAIL: no download button'); cdp.close(); process.exit(1); }

    console.log('>>> clicking 下载并安装 — this will download 201MB then AUTO-INSTALL');
    await evl(cdp, `document.getElementById('btn-dl-shell').click(); true`);

    // poll for install trigger (app will quit when SU.install() runs)
    for (let i = 0; i < 180; i++) {
        await sleep(2000);
        const st = await evl(cdp, `JSON.stringify({
            status: document.getElementById('shell-update-status')?.textContent,
            btn: document.getElementById('btn-dl-shell')?.textContent || 'NO-BTN',
            progress: document.getElementById('shell-progress-text')?.textContent || '',
            done: document.getElementById('btn-dl-shell')?.dataset?.done || ''
        })`).catch(() => 'APP_EXITED');
        console.log(`t+${(i+1)*2}s:`, st);
        if (st === 'APP_EXITED' || /安装中|正在安装/.test(st)) break;
    }
    console.log('>>> waiting for installer to finish & app restart (up to 60s)...');
    await sleep(45000);

    // after restart, app should be v1.6.7 — verify via new CDP connection
    let finalVer = 'unknown';
    for (let i = 0; i < 30; i++) {
        try {
            const t2 = await getTargets();
            const page = t2.find(x => x.type === 'page' && /shell\.html/.test(x.url));
            if (page) {
                const c2 = await connect(page.webSocketDebuggerUrl);
                finalVer = await evl(c2, `document.getElementById('shell-version-display')?.textContent || ''`);
                c2.close();
                if (finalVer) break;
            }
        } catch (_) {}
        await sleep(2000);
    }
    console.log('FINAL installed shell version:', finalVer);
    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
