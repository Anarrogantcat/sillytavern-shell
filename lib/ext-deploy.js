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

/**
 * 只做判断，不写盘（供测试与「先看一眼会发生什么」用）
 * @returns {Array<{id, action, version, targetVersion, reason}>}
 */
export function planDeploy({ srcRoot, dataRoot, force = false }) {
    const rows = [];
    const extRoot = extensionsRoot(dataRoot);
    for (const item of listBundled(srcRoot)) {
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

/**
 * 执行部署
 * @param {{srcRoot:string, dataRoot:string, log?:Function, force?:boolean, now?:Function}} opts
 * @returns {{dataRootMissing:boolean, deployed:Array, skipped:Array, failed:Array, extRoot:string}}
 */
export function deployExtensions(opts = {}) {
    const { srcRoot, dataRoot, force = false } = opts;
    const log = typeof opts.log === 'function' ? opts.log : () => {};
    const now = typeof opts.now === 'function' ? opts.now : () => new Date().toISOString();
    const result = { dataRootMissing: false, deployed: [], skipped: [], failed: [], extRoot: dataRoot ? extensionsRoot(dataRoot) : '' };

    if (!srcRoot || !fs.existsSync(srcRoot)) { log('[ext] 未找到内置扩展目录：' + srcRoot); return result; }
    const userRoot = dataRoot ? path.join(dataRoot, 'default-user') : '';
    if (!userRoot || !fs.existsSync(userRoot)) {
        result.dataRootMissing = true;
        log('[ext] ST 数据目录还没初始化（' + (userRoot || dataRoot || '?') + '），稍后重试');
        return result;
    }
    const bundled = listBundled(srcRoot);
    if (!bundled.length) { log('[ext] 内置扩展清单为空'); return result; }

    const extRoot = extensionsRoot(dataRoot);
    fs.mkdirSync(extRoot, { recursive: true });
    for (const row of planDeploy({ srcRoot, dataRoot, force })) {
        const item = bundled.find((b) => b.id === row.id);
        if (!item) continue;
        if (row.action === 'skip-same' || row.action === 'skip-newer' || row.action === 'skip-unknown') {
            result.skipped.push(row);
            log('[ext] ' + row.id + ' ' + row.version + ' 跳过：' + row.reason);
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
    if (!result.deployed.length && !result.failed.length) log('[ext] 内置扩展均为最新，无需动作');
    return result;
}
