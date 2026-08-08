// Repro with real user config copy: check float-buttons state + tools panel + errors
const CDP_BASE = 'http://127.0.0.1:9243';
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
    if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400);
    return r.result?.value;
}
async function main() {
    let targets;
    for (let i = 0; i < 25; i++) {
        try { targets = await getTargets(); if (targets.length) break; } catch (_) {}
        await sleep(1000);
    }
    const t = targets.find(x => x.type === 'page' && /shell\.html/.test(x.url));
    if (!t) { console.log('FAIL: no page'); process.exit(1); }
    const cdp = await connect(t.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    await evl(cdp, `window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(e.message)); true`);

    // 1. float-buttons state
    console.log('float-buttons collapsed:', await evl(cdp, `document.getElementById('float-buttons')?.classList.contains('collapsed')`));
    console.log('btn-tools 存在:', await evl(cdp, `!!document.getElementById('btn-tools')`));
    console.log('btn-tools 可见 (offsetParent):', await evl(cdp, `document.getElementById('btn-tools')?.offsetParent !== null`));
    console.log('btn-tools rect:', await evl(cdp, `JSON.stringify(document.getElementById('btn-tools')?.getBoundingClientRect())`));
    console.log('fabs collapsed 类完整:', await evl(cdp, `document.getElementById('float-buttons')?.className`));

    // 2. click tools
    const clickResult = await evl(cdp, `(function(){const b=document.getElementById('btn-tools');if(!b)return 'no btn';b.click();return 'clicked';})()`);
    console.log('click:', clickResult);
    await sleep(1200);
    console.log('工具箱打开:', await evl(cdp, `!document.getElementById('tools-panel').classList.contains('hidden')`));
    console.log('tools-panel rect:', await evl(cdp, `JSON.stringify(document.getElementById('tools-panel').getBoundingClientRect())`));
    console.log('tools-panel 可见:', await evl(cdp, `document.getElementById('tools-panel').offsetParent !== null`));

    // 3. errors + console
    console.log('页面错误:', await evl(cdp, `JSON.stringify(window.__errs)`));
    console.log('lock-overlay 状态:', await evl(cdp, `document.getElementById('lock-overlay').classList.contains('hidden')`));

    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
