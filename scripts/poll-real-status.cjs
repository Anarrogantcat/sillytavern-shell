// Poll the real installed app's shell-update status for 60s
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
    const targets = await getTargets();
    const t = targets.find(x => x.type === 'page' && /shell\.html/.test(x.url));
    const cdp = await connect(t.webSocketDebuggerUrl);
    for (let i = 0; i < 30; i++) {
        await sleep(3000);
        const st = await evl(cdp, `JSON.stringify({
            status: document.getElementById('shell-update-status')?.textContent,
            btn: document.getElementById('btn-dl-shell')?.textContent || 'NO-BTN',
            shellVersion: document.getElementById('shell-version-display')?.textContent
        })`);
        console.log(`t+${(i+1)*3}s:`, st);
        const p = JSON.parse(st);
        if (!/检查中/.test(p.status)) break;
    }
    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
