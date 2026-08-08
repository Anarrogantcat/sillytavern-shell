// E2E test the Tools toolbox (A/B/C/D) via CDP
const CDP_BASE = 'http://127.0.0.1:9239';
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

    // 1. open tools panel
    await evl(cdp, `document.getElementById('btn-tools').click(); true`);
    await sleep(800);
    console.log('panel open:', await evl(cdp, `!document.getElementById('tools-panel').classList.contains('hidden')`));
    console.log('backup dir loaded:', await evl(cdp, `document.getElementById('t-backup-dir').value`));

    // 2. A1 backup now
    console.log('--- A1 备份 ---');
    await evl(cdp, `document.getElementById('t-backup-now').click(); true`);
    await sleep(3000);
    console.log('backup info:', await evl(cdp, `document.getElementById('t-backup-info').textContent`));

    // 3. B7 search
    console.log('--- B7 搜索 ---');
    await evl(cdp, `document.getElementById('t-search-kw').value='你好'; true`);
    await evl(cdp, `document.getElementById('t-search-kw').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
    await sleep(2000);
    const searchRes = await evl(cdp, `document.getElementById('t-search-res').textContent.slice(0,150)`);
    console.log('search:', searchRes || '(空)');

    // 4. B11 stats
    console.log('--- B11 统计 ---');
    await evl(cdp, `document.getElementById('t-stats').click(); true`);
    await sleep(2000);
    console.log('stats:', await evl(cdp, `document.getElementById('t-stats-res').textContent`));

    // 5. C12 env check
    console.log('--- C12 体检 ---');
    await evl(cdp, `document.getElementById('t-env').click(); true`);
    await sleep(6000);
    console.log('env:', (await evl(cdp, `document.getElementById('t-env-res').textContent`)).slice(0, 300));

    // 6. C13 ollama
    console.log('--- C13 Ollama ---');
    await evl(cdp, `document.getElementById('t-ollama').click(); true`);
    await sleep(2500);
    console.log('ollama:', (await evl(cdp, `document.getElementById('t-env-res').textContent`)).slice(0, 200));

    // 7. C14 gpu
    console.log('--- C14 显存 ---');
    await evl(cdp, `document.getElementById('t-gpu').click(); true`);
    await sleep(1500);
    console.log('gpu:', await evl(cdp, `document.getElementById('t-env-res').textContent`));

    // 8. C15 clash
    console.log('--- C15 Clash ---');
    await evl(cdp, `document.getElementById('t-clash').click(); true`);
    await sleep(1500);
    console.log('clash:', await evl(cdp, `document.getElementById('t-env-res').textContent`));

    // 9. D16 chat window
    console.log('--- D16 独立对话窗口 ---');
    await evl(cdp, `document.getElementById('t-chat').click(); true`);
    await sleep(2500);
    const targets2 = await getTargets();
    const chatPage = targets2.find(x => /chat\.html/.test(x.url));
    console.log('chat window opened:', !!chatPage);

    // 10. PIN set/verify/clear via IPC
    console.log('--- A3 PIN ---');
    console.log('pin set:', await evl(cdp, `JSON.stringify(await window.electronAPI.tools.pinSet('1234'))`));
    console.log('pin verify ok:', await evl(cdp, `JSON.stringify(await window.electronAPI.tools.pinVerify('1234'))`));
    console.log('pin verify bad:', await evl(cdp, `JSON.stringify(await window.electronAPI.tools.pinVerify('9999'))`));
    console.log('pin clear:', await evl(cdp, `JSON.stringify(await window.electronAPI.tools.pinSet(''))`));
    console.log('pin has:', await evl(cdp, `JSON.stringify((await window.electronAPI.tools.pinGet()).hasPin)`));

    // 11. rollback list (expect empty)
    console.log('--- A2 回滚列表 ---');
    console.log('rollback:', await evl(cdp, `JSON.stringify(await window.electronAPI.tools.rollbackList())`));

    // 12. autostart get
    console.log('--- A5 自启 ---');
    console.log('autostart:', await evl(cdp, `JSON.stringify(await window.electronAPI.tools.autostartGet())`));

    // 13. D17 draft (real Ollama, skip - slow) - test model detect only
    console.log('--- D17 模型检测 ---');
    console.log('chatModel:', await evl(cdp, `JSON.stringify(await window.electronAPI.tools.chatModel()).slice(0,80)`));

    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
