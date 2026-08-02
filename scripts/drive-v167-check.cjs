// Drive packaged v1.6.7: open settings → check shell update → verify no EPIPE crash
const CDP_BASE = 'http://127.0.0.1:9224';
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
    if (!t) { console.log('FAIL: no page target'); process.exit(1); }
    const cdp = await connect(t.webSocketDebuggerUrl);
    console.log('connected, title:', await evl(cdp, 'document.title'));

    // open settings → auto checkShellUpdate
    await evl(cdp, `document.getElementById('btn-settings')?.click(); true`);
    await sleep(5000);
    const st = await evl(cdp, `JSON.stringify({
        status: document.getElementById('shell-update-status')?.textContent,
        shellVer: document.getElementById('shell-version-display')?.textContent,
        alive: !!document.getElementById('btn-settings')
    })`);
    console.log('after check:', st);

    // also click manual check button to trigger another updater log cycle
    await evl(cdp, `document.getElementById('btn-check-shell-update')?.click(); true`);
    await sleep(5000);
    const st2 = await evl(cdp, `document.getElementById('shell-update-status')?.textContent`);
    console.log('after manual re-check:', st2);

    // open terminal and look for [updater] logs
    await evl(cdp, `document.getElementById('btn-terminal')?.click(); true`);
    await sleep(800);
    const termText = await evl(cdp, `document.getElementById('terminal-output')?.innerText || ''`);
    const updaterLogs = (termText.match(/\[updater\]/g) || []).length;
    console.log('[updater] log lines in terminal:', updaterLogs);
    if (updaterLogs > 0) {
        const sample = termText.split('\n').filter(l => l.includes('[updater]')).slice(0, 4).join('\n');
        console.log('sample:\n', sample);
    }
    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
