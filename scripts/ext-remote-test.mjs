// scripts/ext-remote-test.mjs — 在线更新通道夹具（假 fetchText，不联网）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from './ext-index.mjs';
import crypto from 'node:crypto';
import { parseIndex, planRemoteUpdates, fetchIndex, applyRemoteUpdates, summarizeRemote, normalizeText, DEFAULT_BASES } from '../lib/ext-remote.js';

const sha1hex = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
import { extensionsRoot, readManifest } from '../lib/ext-deploy.js';

let pass = 0; const fails = [];
const ok = (n, c, extra) => { if (c) pass++; else fails.push(n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { actual: a, expected: b });

// 必须走 fileURLToPath：import.meta.url 里空格/中文是百分号编码的，直接切 pathname 会拿到不存在的路径
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-extremote-'));
const dataRoot = path.join(tmp, 'Data');
fs.mkdirSync(path.join(dataRoot, 'default-user'), { recursive: true });

// 用真实仓库内容造一份清单（模拟 CDN 上的 index.json）
const index = buildIndex(repoRoot);
const BASE = 'https://cdn.example/extensions';
const store = new Map();
for (const e of index.extensions) {
    for (const f of e.files) {
        const full = path.join(repoRoot, 'extensions', e.id, f.path);
        store.set(BASE + '/' + e.id + '/' + f.path, normalizeText(fs.readFileSync(full, 'utf8')));
    }
}
// 生产代码会给每个请求带 ?t= 缓存穿透参数，假 fetch 要按「去掉 query」查表
const strip = (u) => String(u).split('?')[0];
const fakeFetch = async (url) => { const k = strip(url); if (!store.has(k)) throw new Error('404 ' + k); return store.get(k); };
const boom = async () => { throw new Error('network down'); };

eq('清单可解析', !!parseIndex(JSON.stringify(index)), true);
eq('坏清单返回 null', parseIndex('{ not json'), null);
eq('schema 不符返回 null', parseIndex(JSON.stringify({ schema: 9, extensions: [] })), null);

// ① 本地空 → 全部 install
let plan = planRemoteUpdates(index, dataRoot);
eq('空目录 → 全部 install', plan.map((x) => x.id + ':' + x.action), index.extensions.map((e) => e.id + ':install'));

// ② 拉清单：第一个 base 挂掉 → 用第二个
const bases = ['https://dead.example/x', BASE];
store.set(BASE + '/index.json', JSON.stringify(index));
const got = await fetchIndex({ fetchText: fakeFetch, bases, log: () => {} });
eq('首个 base 失败自动换下一个', [got.ok, got.base], [true, BASE]);
const got2 = await fetchIndex({ fetchText: boom, bases, log: () => {} });
eq('全部 base 失败 → ok:false 且记录原因', [got2.ok, got2.tried.length], [false, 2]);

// ③ 应用更新（happy path）
let res = await applyRemoteUpdates({ index, base: BASE, dataRoot, fetchText: fakeFetch, log: () => {}, now: () => 'T' });
eq('全部扩展已安装', res.updated.map((u) => u.id).sort(), index.extensions.map((e) => e.id).sort());
eq('失败列表为空', res.failed.length, 0);
const cc = readManifest(path.join(extensionsRoot(dataRoot), 'card-compat'));
eq('落地的版本与清单一致', cc.version, index.extensions.find((e) => e.id === 'card-compat').version);
eq('写出部署记录', fs.existsSync(path.join(extensionsRoot(dataRoot), 'card-compat', '.shell-deployed.json')), true);

// ④ 幂等：再跑一次 → 全部 skip
res = await applyRemoteUpdates({ index, base: BASE, dataRoot, fetchText: fakeFetch, log: () => {} });
eq('第二次全部 skip', [res.updated.length, res.skipped.length], [0, index.extensions.length]);

// ⑤ 篡改内容 → 哈希不符，拒绝写盘（本地内容保持旧值）
const before = fs.readFileSync(path.join(extensionsRoot(dataRoot), 'card-compat', 'index.js'), 'utf8');
store.set(BASE + '/card-compat/index.js', before + '\n// tampered');
const bumped = JSON.parse(JSON.stringify(index));
bumped.extensions.find((e) => e.id === 'card-compat').version = '9.9.9';
res = await applyRemoteUpdates({ index: bumped, base: BASE, dataRoot, fetchText: fakeFetch, log: () => {} });
eq('哈希不符 → 记失败', res.failed.map((f) => f.id), ['card-compat']);
eq('哈希不符 → 本地未被改写', fs.readFileSync(path.join(extensionsRoot(dataRoot), 'card-compat', 'index.js'), 'utf8'), before);
eq('哈希不符 → 版本没被改', readManifest(path.join(extensionsRoot(dataRoot), 'card-compat')).version !== '9.9.9', true);

// ⑥ 下载缺文件 → 不写盘
store.delete(BASE + '/plot-pilot/style.css');
const bumped2 = JSON.parse(JSON.stringify(index));
bumped2.extensions.find((e) => e.id === 'plot-pilot').version = '8.8.8';
res = await applyRemoteUpdates({ index: bumped2, base: BASE, dataRoot, fetchText: fakeFetch, log: () => {} });
eq('缺文件 → 失败且不半套写盘', [res.failed.map((f) => f.id), readManifest(path.join(extensionsRoot(dataRoot), 'plot-pilot')).version !== '8.8.8', res.updated.length], [['plot-pilot'], true, 0]);

// ⑦ 源陈旧（内容与清单 sha1 不符）→ 自动换下一个源并成功安装
// 注意：前面的用例已经把 store 里的 card-compat/index.js 改脏、删掉了 plot-pilot/style.css，
// 这里必须**重新**从仓库原始文件搭一份干净的「多源」表，否则测的是脏数据。
const good = normalizeText(fs.readFileSync(path.join(repoRoot, 'extensions', 'card-compat', 'index.js'), 'utf8'));
const bogusBase = 'https://stale.example/extensions';
const multiStore = new Map();
for (const e of index.extensions) {
    for (const f of e.files) {
        multiStore.set(BASE + '/' + e.id + '/' + f.path, normalizeText(fs.readFileSync(path.join(repoRoot, 'extensions', e.id, f.path), 'utf8')));
    }
}
multiStore.set(bogusBase + '/card-compat/index.js', 'stale content');   // 第一个源只有这一个文件是旧的
multiStore.set(BASE + '/card-compat/index.js', good);                   // 第二个源是好的
const multiFetch = async (url) => { const k = strip(url); if (!multiStore.has(k)) throw new Error('404 ' + k); return multiStore.get(k); };
const freshData = path.join(tmp, 'Data5');
fs.mkdirSync(path.join(freshData, 'default-user'), { recursive: true });
multiStore.set(bogusBase + '/index.json', JSON.stringify(index));
const gotIdx = await fetchIndex({ fetchText: multiFetch, bases: [bogusBase, BASE], log: () => {} });
eq('清单可来自第一个源', gotIdx.base, bogusBase);
const resFallback = await applyRemoteUpdates({ index, base: bogusBase, bases: [bogusBase, BASE], dataRoot: freshData, fetchText: multiFetch, log: () => {} });
eq('陈旧源 → 自动换源后仍成功', [resFallback.failed.length, resFallback.updated.map((u) => u.id).sort()], [0, index.extensions.map((e) => e.id).sort()]);
eq('换源后写的是正确内容', fs.readFileSync(path.join(extensionsRoot(freshData), 'card-compat', 'index.js'), 'utf8'), good);

// ⑧ 二进制文件：按字节取 + 按字节校验（不走文本归一）
const binIndex = { schema: 1, extensions: [{ id: 'bin-ext', version: '1.0.0', files: [
    { path: 'manifest.json', size: 20, sha1: sha1hex(Buffer.from('{"version":"1.0.0"}', 'utf8')) },
    { path: 'icon.png', size: 4, sha1: sha1hex(Buffer.from([0x89, 0x50, 0x4e, 0x47])), bin: true },
] }] };
const binStore = new Map([
    ['https://cdn.example2/bin-ext/manifest.json', '{"version":"1.0.0"}'],
]);
const binFetchText = async (u) => { const k = strip(u); if (!binStore.has(k)) throw new Error('404 ' + k); return binStore.get(k); };
const binFetchBinary = async (u) => { if (strip(u).includes('icon.png')) return Uint8Array.from([0x89, 0x50, 0x4e, 0x47]); throw new Error('404 ' + strip(u)); };
const binData = path.join(tmp, 'Data6');
fs.mkdirSync(path.join(binData, 'default-user'), { recursive: true });
let resBin = await applyRemoteUpdates({ index: binIndex, base: 'https://cdn.example2', bases: ['https://cdn.example2'], dataRoot: binData, fetchText: binFetchText, fetchBinary: binFetchBinary, log: () => {} });
eq('二进制扩展安装成功', [resBin.failed.length, resBin.updated.map((u) => u.id)], [0, ['bin-ext']]);
eq('二进制字节原样落地', [...fs.readFileSync(path.join(extensionsRoot(binData), 'bin-ext', 'icon.png'))], [0x89, 0x50, 0x4e, 0x47]);
const binData2 = path.join(tmp, 'Data7');
fs.mkdirSync(path.join(binData2, 'default-user'), { recursive: true });
const resNoBin = await applyRemoteUpdates({ index: binIndex, base: 'https://cdn.example2', bases: ['https://cdn.example2'], dataRoot: binData2, fetchText: binFetchText, log: () => {} });
eq('缺 fetchBinary → 明确报错且不写盘', [resNoBin.failed.length, fs.existsSync(path.join(extensionsRoot(binData2), 'bin-ext'))], [1, false]);

// ⑨ 摘要与 CRLF 归一
eq('摘要含"均为最新"', summarizeRemote({ updated: [], skipped: [], failed: [] }), '均为最新');
ok('摘要含更新条目', summarizeRemote({ updated: [{ id: 'x', from: '1.0.0', to: '1.0.1' }], failed: [] }).includes('1.0.0→1.0.1'), summarizeRemote({ updated: [{ id: 'x', from: '1.0.0', to: '1.0.1' }], failed: [] }));
eq('CRLF 归一', normalizeText('a\r\nb'), 'a\nb');
eq('默认 base 有两条', DEFAULT_BASES.length, 2);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
if (fails.length) { console.log('夹具结果：' + pass + ' 项通过，' + fails.length + ' 项失败'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('夹具结果：' + pass + '/' + pass + ' 全部通过');
