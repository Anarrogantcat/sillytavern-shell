// Test the auto watcher: append fake messages to the fake chat file, verify sessions accumulate to 3 and suggestion appears
const fs = require('fs');
const path = require('path');
const chatFile = 'D:/AI/sillytavern-shell/.smoke/bench-data/default-user/chats/测试卡/测试聊天.jsonl';
const CDP_BASE = 'http://127.0.0.1:9236';

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
// simulate a chat message as ST writes it: {name, is_user, mes, send_date}
function appendMsg(isUser, text, offsetMin = 0) {
    const msg = {
        name: isUser ? '测试用户' : '测试卡',
        is_user: isUser,
        send_date: new Date(Date.now() - offsetMin * 60 * 1000).toISOString(),
        mes: text,
        extra: {}, swipe_id: 0, swipes: [text], gen_started: Date.now() - 5000, gen_finished: Date.now(),
    };
    fs.appendFileSync(chatFile, JSON.stringify(msg) + '\n', 'utf8');
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

    // Wait for watcher to bind, then simulate 3 chat sessions 12+ min apart
    await sleep(3000);
    console.log('--- session 1 (t-25min): user msg + char reply ---');
    appendMsg(true, '你好呀，我们开始聊天吧！今天天气真好。', 25);
    await sleep(1500);
    appendMsg(false, '嗨！很高兴见到你。天气确实不错，我们可以一起出去走走。你觉得呢？', 25);
    await sleep(4000);
    console.log('sessions:', await evl(cdp, `JSON.stringify((await window.electronAPI.bench.status()).sessions)`));

    console.log('--- session 2 (t-13min): user msg + char reply (long) ---');
    appendMsg(true, '我想听你讲一个关于星际旅行的故事。', 13);
    await sleep(1500);
    appendMsg(false, '好吧，让我想想。在遥远的未来，一艘名为"星尘号"的飞船穿越银河系，船上的AI导航员每天都会和宇航员聊天解闷……'.repeat(8), 13);
    await sleep(4000);
    console.log('sessions:', await evl(cdp, `JSON.stringify((await window.electronAPI.bench.status()).sessions)`));

    console.log('--- session 3 (now): user msg + char reply ---');
    appendMsg(true, '这个故事太棒了！继续讲下去！', 0);
    await sleep(1500);
    appendMsg(false, '星尘号继续航行，他们遇到了一个神秘的中子星……'.repeat(5), 0);
    await sleep(6000);
    const st = await evl(cdp, `JSON.stringify((await window.electronAPI.bench.status()).sessions)`);
    console.log('sessions:', st);
    const sug = await evl(cdp, `JSON.stringify((await window.electronAPI.bench.status()).suggestion)`);
    console.log('suggestion:', sug);
    cdp.close();
    process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
