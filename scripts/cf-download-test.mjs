// scripts/cf-download-test.mjs — cloudflared 按需下载夹具（本机 HTTP 服务，不联网）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { downloadCloudflared, exeOk, sha256File, readMeta, MIN_BYTES } from '../lib/cf-download.js';

let pass = 0; const fails = [];
const ok = (n, c, extra) => { if (c) pass++; else fails.push(n + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { actual: a, expected: b });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cfdl-'));
const dir = path.join(tmp, 'pack');
const PE = Buffer.alloc(MIN_BYTES + 1024, 7);
PE[0] = 0x4d; PE[1] = 0x5a;
let requests = 0;
const srv = http.createServer((req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(PE.length) });
    res.end(PE);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + srv.address().port + '/cloudflared.exe';
const fetchImpl = (u, o) => fetch(u, o);

eq('缺目录 -> 失败', (await downloadCloudflared({ dir: '' })).ok, false);
eq('没有 fetch -> 失败', (await downloadCloudflared({ dir: dir, fetchImpl: null })).ok, false);

const badDir = path.join(tmp, 'bad');
fs.mkdirSync(badDir, { recursive: true });
const badBody = Buffer.from('<html>404 not found</html>');
const badSrv = http.createServer((req, res) => { res.writeHead(200, { 'content-length': String(badBody.length) }); res.end(badBody); });
await new Promise((r) => badSrv.listen(0, '127.0.0.1', r));
const r2 = await downloadCloudflared({ dir: badDir, url: 'http://127.0.0.1:' + badSrv.address().port + '/x', fetchImpl });
ok('非 PE 内容 -> 失败', r2.ok === false && String(r2.error).indexOf('有效的 cloudflared') >= 0, r2);
ok('失败后不留 .part / 不产出 exe', !fs.existsSync(path.join(badDir, 'cloudflared.exe.part')) && !fs.existsSync(path.join(badDir, 'cloudflared.exe')));

const prog = [];
const r3 = await downloadCloudflared({ dir, url, fetchImpl, onProgress: (g, t) => prog.push([g, t]) });
ok('下载成功且文件落盘', r3.ok === true && fs.existsSync(r3.path), r3);
eq('字节数正确', r3.bytes, PE.length);
eq('meta 记录 sha256 与实际一致', readMeta(dir)?.sha256, sha256File(r3.path));
ok('进度回调收到数据且最终等于总长度', prog.length > 0 && prog[prog.length - 1][0] === PE.length, prog.slice(-1));
ok('exeOk 认这个文件', exeOk(r3.path) === true);
ok('reused=false（是下载来的）', r3.reused === false);

const before = requests;
const r4 = await downloadCloudflared({ dir, url, fetchImpl });
ok('已存在且哈希一致 -> 复用且不再请求', r4.ok === true && r4.reused === true && requests === before, { reused: r4.reused, delta: requests - before });

const tamper = Buffer.alloc(MIN_BYTES + 2048, 9);
tamper[0] = 0x4d; tamper[1] = 0x5a;
fs.writeFileSync(r3.path, tamper);
const r5 = await downloadCloudflared({ dir, url, fetchImpl });
ok('哈希不符 -> 重新下载', r5.ok === true && r5.reused === false && requests === before + 1, { reused: r5.reused, delta: requests - before });
eq('重下后 meta 哈希回到正确值', readMeta(dir)?.sha256, sha256File(r5.path));

// 清理做成幂等的，并挂到异常/退出路径上：原先这三行在末尾，中间任何一步抛错就会跳过，泄漏 20MB+ 临时目录
function cleanupOnce() {
    if (cleanupOnce.done) return;
    cleanupOnce.done = true;
    try { badSrv.close(); } catch (_) {}
    try { srv.close(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
process.on('uncaughtException', (e) => { cleanupOnce(); console.error('UNCAUGHT:', e && e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { cleanupOnce(); console.error('REJECTION:', e && e.message); process.exit(1); });
cleanupOnce();
console.log('');
console.log('结果: pass=' + pass + ' fail=' + fails.length);
if (fails.length) { console.log('失败项：'); for (const f of fails) console.log('  ❌ ' + f); }
process.exit(fails.length ? 1 : 0);
