// lib/ext-deploy.js — 把「套壳内置的 ST 扩展」部署到用户数据目录
// 背景：安装包的 files 列表过去不含 extensions/，也没人往 dataRoot 里写扩展，
//       结果别的用户装了套壳，card-compat / plot-pilot 一个都没有（本次修复）。
// 原则：
//   ① 只碰「内置清单里」的扩展，用户自己的其它扩展目录一律不动；
//   ② 目标不存在 → 安装；内置版本比目标 manifest 版本新 → 更新；相等或更旧 → 跳过；
//   ③ 目标目录没有 manifest.json（不是合规扩展）→ 不碰，只报告；
//   ④ 覆盖前不删除目标里的其它文件（不做镜像同步），只写我们自带的文件；
//   ⑤ 每次部署写一份 .shell-deployed.json（版本 + 内容哈希 + 时间）留痕，便于排查与将来的回滚。
// 纯 node:fs 实现，无 electron 依赖，可直接被 scripts/ext-deploy-test.mjs 测试。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RECORD_NAME = '.shell-deployed.json';

/** 版本比较：0.2.1 < 0.10.0；非法段按 0 处理 */
export function compareVersions(a, b) {
    const toNum = (v) => String(v == null ? '0' : v).split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    const pa = toNum(a), pb = toNum(b);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
}

export function readManifest(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { return null; }
}

export function walkFiles(dir, base = dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkFiles(p, base, out);
        else out.push(path.relative(base, p).split(path.sep).join('/'));
    }
    return out;
}

/** 目录内容哈希（排序后的相对路径 + 文件内容） */
export function hashTree(dir) {
    const h = crypto.createHash('sha1');
    for (const rel of walkFiles(dir).sort()) {
        h.update(rel);
        h.update(fs.readFileSync(path.join(dir, rel)));
    }
    return h.digest('hex').slice(0, 12);
}

/** 内置扩展清单（只看带 manifest.json 的子目录） */
export function listBundled(srcRoot) {
    if (!srcRoot || !fs.existsSync(srcRoot)) return [];
    return fs.readdirSync(srcRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(srcRoot, e.name, 'manifest.json')))
        .map((e) => {
            const srcDir = path.join(srcRoot, e.name);
            const mf = readManifest(srcDir) || {};
            return { id: e.name, srcDir, version: String(mf.version || '0'), displayName: String(mf.display_name || e.name) };
        });
}

export function extensionsRoot(dataRoot) {
    return path.join(dataRoot, 'default-user', 'extensions');
}

/** 路径安全：只允许扩展目录内的相对路径 */
export function isSafeRelPath(rel) {
    const p = String(rel || '').split('\\').join('/');
    if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
    if (p.split('/').some((seg) => seg === '..' || seg === '')) return false;
    return true;
}

/** 校验一份「下载好的扩展载荷」：路径安全 + 哈希匹配 */
export function verifyPayload(payload, opts = {}) {
    const cryptoMod = opts.crypto || crypto;
    const problems = [];
    if (!payload || !payload.id) problems.push('缺少 id');
    const files = (payload && payload.files) || [];
    if (!files.length) problems.push('没有文件');
    for (const f of files) {
        if (!isSafeRelPath(f.path)) { problems.push('非法路径: ' + f.path); continue; }
        if (f.sha1) {
            const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content == null ? '' : f.content), 'utf8');
            const got = cryptoMod.createHash('sha1').update(buf).digest('hex');
            if (got !== String(f.sha1)) problems.push('哈希不符: ' + f.path);
        }
    }
    return { ok: problems.length === 0, problems };
}

/**
 * 把「已经在内存里的扩展载荷」写到数据目录（在线更新/离线包都用这条）
 * @param {{id:string, version:string, files:Array<{path:string, content:string|Buffer, sha1?:string}>}} payload
 * @returns {{ok:boolean, id:string, version:string, action:'install'|'update', written:number, reason?:string}}
 */
export function installFromPayload(payload, opts = {}) {
    const { dataRoot, force = false, now = () => new Date().toISOString() } = opts;
    const log = typeof opts.log === 'function' ? opts.log : () => {};
    const id = payload ? String(payload.id || '') : '';
    const version = payload ? String(payload.version || '0') : '0';
    if (!id || !dataRoot) return { ok: false, id, version, action: 'install', written: 0, reason: '缺少 id 或 dataRoot' };
    const userRoot = path.join(dataRoot, 'default-user');
    if (!fs.existsSync(userRoot)) return { ok: false, id, version, action: 'install', written: 0, reason: 'ST 数据目录尚未初始化' };

    const v = verifyPayload(payload);
    if (!v.ok) { log('[ext] ' + id + ' 载荷校验失败：' + v.problems.join('；')); return { ok: false, id, version, action: 'install', written: 0, reason: v.problems.join('；') }; }

    const dstDir = path.join(extensionsRoot(dataRoot), id);
    const targetManifest = fs.existsSync(dstDir) ? readManifest(dstDir) : null;
    const targetVersion = targetManifest ? String(targetManifest.version || '0') : '';
    if (targetManifest && compareVersions(version, targetVersion) <= 0 && !force) {
        log('[ext] ' + id + ' 已是 ' + targetVersion + '（在线 ' + version + '），跳过');
        return { ok: true, id, version, action: 'update', written: 0, reason: '已是最新' };
    }
    let written = 0;
    try {
        for (const f of payload.files) {
            const to = path.join(dstDir, f.path);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content == null ? '' : f.content), 'utf8');
            fs.writeFileSync(to, buf);
            written++;
        }
        fs.writeFileSync(path.join(dstDir, RECORD_NAME), JSON.stringify({
            id, version, action: targetManifest ? 'update' : 'install',
            from: targetVersion || null, hash: hashTree(dstDir), source: 'remote', at: now(),
        }, null, 2) + '\n', 'utf8');
    } catch (e) {
        log('[ext] ' + id + ' 写入失败：' + String((e && e.message) || e));
        return { ok: false, id, version, action: targetManifest ? 'update' : 'install', written, reason: String((e && e.message) || e) };
    }
    log('[ext] ' + id + ' ' + version + ' ' + (targetManifest ? '已更新' : '已安装') + '（在线通道，' + written + ' 个文件）');
    return { ok: true, id, version, action: targetManifest ? 'update' : 'install', written };
}

/**
 * 只做判断，不写盘（供测试与「先看一眼会发生什么」用）
 * @returns {Array<{id, action, version, targetVersion, reason}>}
 */
export function planDeploy({ srcRoot, dataRoot, force = false, only = null }) {
    const rows = [];
    const extRoot = extensionsRoot(dataRoot);
    const onlySet = only ? new Set(Array.isArray(only) ? only : [only]) : null;
    for (const item of listBundled(srcRoot)) {
        if (onlySet && !onlySet.has(item.id)) continue;
        const dstDir = path.join(extRoot, item.id);
        const targetExists = fs.existsSync(dstDir);
        const targetManifest = targetExists ? readManifest(dstDir) : null;
        const targetVersion = targetManifest ? String(targetManifest.version || '0') : '';
        if (!targetExists) { rows.push({ id: item.id, action: 'install', version: item.version, targetVersion: '', reason: '目标不存在' }); continue; }
        if (!targetManifest) { rows.push({ id: item.id, action: 'skip-unknown', version: item.version, targetVersion: '', reason: '目标目录没有 manifest.json，不是合规扩展，不碰' }); continue; }
        const cmp = compareVersions(item.version, targetVersion);
        if (cmp > 0) rows.push({ id: item.id, action: 'update', version: item.version, targetVersion, reason: targetVersion + ' → ' + item.version });
        else if (cmp === 0) rows.push({ id: item.id, action: force ? 'update' : 'skip-same', version: item.version, targetVersion, reason: force ? '强制覆盖同版本' : '已是最新（' + targetVersion + '）' });
        else rows.push({ id: item.id, action: force ? 'update' : 'skip-newer', version: item.version, targetVersion, reason: force ? '强制降级覆盖' : '目标版本更新（' + targetVersion + '），不降级' });
    }
    return rows;
}

function copyTree(srcDir, dstDir) {
    for (const rel of walkFiles(srcDir)) {
        const from = path.join(srcDir, rel), to = path.join(dstDir, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
    }
}

/** 一行摘要（给调用方打日志用；quiet 模式下只留这一行） */
export function buildSummary(result) {
    if (!result) return '';
    if (result.dataRootMissing) return 'ST 数据目录尚未初始化，已安排重试';
    if (result.failed && result.failed.length) return '失败：' + result.failed.map((f) => f.id + '(' + f.error + ')').join('、') + (result.deployed.length ? '；成功 ' + result.deployed.length + ' 个' : '');
    if (result.deployed && result.deployed.length) return result.deployed.map((d) => d.id + ' ' + d.version + (d.action === 'install' ? ' 已安装' : ' 已更新')).join('；');
    return '均为最新';
}

/**
 * 执行部署
 * @param {{srcRoot:string, dataRoot:string, log?:Function, force?:boolean, quiet?:boolean, now?:Function}} opts
 *   quiet=true 时「跳过」类日志不打（启动时不会每回都刷一屏"已是最新"），只在真安装/更新/失败时输出；
 *   「什么都没发生」时调用方可以完全不打日志（看 buildSummary 的返回值决定）。
 * @returns {{dataRootMissing:boolean, deployed:Array, skipped:Array, failed:Array, extRoot:string, summary:string}}
 */
export function deployExtensions(opts = {}) {
    const { srcRoot, dataRoot, force = false, quiet = false, only = null } = opts;
    const log = typeof opts.log === 'function' ? opts.log : () => {};
    const say = (s) => { if (!quiet) log(s); };
    const now = typeof opts.now === 'function' ? opts.now : () => new Date().toISOString();
    const result = { dataRootMissing: false, deployed: [], skipped: [], failed: [], extRoot: dataRoot ? extensionsRoot(dataRoot) : '' };

    if (!srcRoot || !fs.existsSync(srcRoot)) { log('[ext] 未找到内置扩展目录：' + srcRoot); result.summary = buildSummary(result); return result; }
    const userRoot = dataRoot ? path.join(dataRoot, 'default-user') : '';
    if (!userRoot || !fs.existsSync(userRoot)) {
        result.dataRootMissing = true;
        log('[ext] ST 数据目录还没初始化（' + (userRoot || dataRoot || '?') + '），稍后重试');
        result.summary = buildSummary(result);
        return result;
    }
    const bundled = listBundled(srcRoot);
    if (!bundled.length) { log('[ext] 内置扩展清单为空'); result.summary = buildSummary(result); return result; }

    const extRoot = extensionsRoot(dataRoot);
    fs.mkdirSync(extRoot, { recursive: true });
    for (const row of planDeploy({ srcRoot, dataRoot, force, only })) {
        const item = bundled.find((b) => b.id === row.id);
        if (!item) continue;
        if (row.action === 'skip-same' || row.action === 'skip-newer' || row.action === 'skip-unknown') {
            result.skipped.push(row);
            say('[ext] ' + row.id + ' ' + row.version + ' 跳过：' + row.reason);
            continue;
        }
        try {
            const dstDir = path.join(extRoot, row.id);
            copyTree(item.srcDir, dstDir);
            fs.writeFileSync(path.join(dstDir, RECORD_NAME), JSON.stringify({
                id: row.id, version: item.version, action: row.action,
                from: row.targetVersion || null, hash: hashTree(item.srcDir), at: now(),
            }, null, 2) + '\n', 'utf8');
            result.deployed.push(row);
            log('[ext] ' + row.id + ' ' + row.version + ' ' + (row.action === 'install' ? '已安装' : '已更新') + '（' + row.reason + '）');
        } catch (e) {
            result.failed.push({ id: row.id, error: String((e && e.message) || e) });
            log('[ext] ' + row.id + ' 部署失败：' + String((e && e.message) || e));
        }
    }
    if (!result.deployed.length && !result.failed.length) say('[ext] 内置扩展均为最新，无需动作');
    result.summary = buildSummary(result);
    return result;
}
