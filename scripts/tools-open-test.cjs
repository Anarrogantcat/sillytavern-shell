// Quick test: tools panel opens + settings panel renders tool settings
const CDP_BASE = 'http://127.0.0.1:9241';
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
    if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300);
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

    // capture console errors
    await evl(cdp, `window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message)); true`);

    // 1. open tools panel
    await evl(cdp, `document.getElementById('btn-tools').click(); true`);
    await sleep(1000);
    console.log('工具箱打开:', await evl(cdp, `!document.getElementById('tools-panel').classList.contains('hidden')`));
    console.log('立即备份按钮存在:', await evl(cdp, `!!document.getElementById('t-backup-now')`));
    console.log('备份配置在设置面板:', await evl(cdp, `!!document.getElementById('t-backup-auto') && !document.getElementById('tools-panel').contains(document.getElementById('t-backup-auto'))`));

    // 2. open settings panel
    await evl(cdp, `document.getElementById('btn-settings').click(); true`);
    await sleep(1500);
    console.log('设置面板打开:', await evl(cdp, `!document.getElementById('settings-overlay').classList.contains('hidden')`));
    console.log('备份目录值:', await evl(cdp, `document.getElementById('t-backup-dir').value`));
    console.log('自动备份开关存在:', await evl(cdp, `!!document.getElementById('t-backup-auto')`));
    console.log('自启下拉存在:', await evl(cdp, `!!document.getElementById('t-autostart')`));
    console.log('回滚信息:', await evl(cdp, `document.getElementById('t-rollback-info').textContent`));

    // 3. errors?
    console.log('页面错误:', await evl(cdp, `JSON.stringify(window.__errs)`));

    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
