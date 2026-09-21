// 作者：小肥鱼（DeepSeek V4 Flash）· 染喵 ｜ 许可：AGPL-3.0 ｜ 项目：https://github.com/Anarrogantcat/sillytavern-shell
// lib/ext-manage.js — ST 扩展管理器（列表 / 卸载 / 回收站还原 / 重置设置 / 强制重装数据）
// 设计原则：
//   ① 只操作 <dataRoot>/default-user/extensions/ 下的目录，且目录名必须通过 isSafeExtId 校验；
//   ② 卸载默认「移进回收站」（extensions/.shell-trash/<id>.<时间戳>）而不是直接删，可还原；
//      purge:true 才真删 —— 调用方（界面）必须显式确认；
//   ③ 重置设置先备份 settings.json（settings.json.shellbak-<时间戳>）再删 extension_settings[id]；
//   ④ 脏标记：目录内容哈希（排除 .shell-deployed.json）与部署记录里的 hash 对比，能看出「被手改过」。
// 纯 node:fs 实现，无 electron 依赖，可直接被 scripts/ext-manage-test.mjs 测试。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RECORD_NAME, compareVersions, extensionsRoot, listBundled, readManifest, walkFiles } from './ext-deploy.js';

export const TRASH_DIR = '.shell-trash';

/** 扩展目录名白名单：字母数字开头，只允许 . _ - */
export function isSafeExtId(id) {
    const s = String(id || '');
    if (!s || s.length > 64) return false;
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s);
}

export function readRecord(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, RECORD_NAME), 'utf8')); } catch (_) { return null; }
}

/** 与 ext-deploy.hashTree 同算法，但排除部署记录文件本身（否则永远判定为「被改过」） */
export function hashTreeOf(dir) {
    const h = crypto.createHash('sha1');
    for (const rel of walkFiles(dir).filter((r) => r !== RECORD_NAME).sort()) {
        h.update(rel);
        try { h.update(fs.readFileSync(path.join(dir, rel))); } catch (_) { /* 读不到就跳过（不影响「有差异」的结论） */ }
    }
    return h.digest('hex').slice(0, 12);
}

export function dirSize(dir) {
    let n = 0;
    for (const rel of walkFiles(dir)) { try { n += fs.statSync(path.join(dir, rel)).size; } catch (_) {} }
    return n;
}

/**
 * 列出数据目录里已安装的扩展（含用户自己装的）
 * @returns {Array<{id,version,displayName,hasManifest,managed,source,installedAt,recordVersion,bundledVersion,updateAvailable,dirty,files,bytes}>}
 */
export function listInstalledExtensions(opts = {}) {
    const dataRoot = opts.dataRoot;
    const bundled = new Map(listBundled(opts.srcRoot || '').map((b) => [b.id, b]));
    if (!dataRoot) return [];
    const extRoot = extensionsRoot(dataRoot);
    if (!fs.existsSync(extRoot)) return [];
    const rows = [];
    for (const e of fs.readdirSync(extRoot, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name === TRASH_DIR) continue;
        if (!isSafeExtId(e.name)) continue;
        const dir = path.join(extRoot, e.name);
        const mf = readManifest(dir);
        const rec = readRecord(dir);
        const b = bundled.get(e.name) || null;
        let dirty = null;
        if (rec && rec.hash) { try { dirty = hashTreeOf(dir) !== String(rec.hash); } catch (_) { dirty = null; } }
        rows.push({
            id: e.name,
            version: mf ? String(mf.version || '0') : '',
            displayName: mf ? String(mf.display_name || e.name) : e.name,
            hasManifest: !!mf,
            managed: !!rec,
            source: rec ? String(rec.source || 'bundled') : (b ? 'bundled-norecord' : 'user'),
            installedAt: rec ? String(rec.at || '') : '',
            recordVersion: rec ? String(rec.version || '') : '',
            bundledVersion: b ? b.version : '',
            updateAvailable: !!(b && mf && compareVersions(b.version, String(mf.version || '0')) > 0),
            dirty,
            files: walkFiles(dir).length,
            bytes: dirSize(dir),
        });
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    return rows;
}

/** 卸载：默认移进回收站；purge:true 才是真删 */
export function uninstallExtension(opts = {}) {
    const dataRoot = opts.dataRoot, id = String(opts.id || '');
    if (!dataRoot) return { ok: false, reason: '缺少数据目录' };
    if (!isSafeExtId(id)) return { ok: false, reason: '扩展 id 不合法（只允许字母数字开头 + . _ -）' };
    const extRoot = extensionsRoot(dataRoot);
    const dir = path.join(extRoot, id);
    if (path.resolve(path.dirname(dir)) !== path.resolve(extRoot)) return { ok: false, reason: '目标不在扩展目录内' };
    if (!fs.existsSync(dir)) return { ok: false, reason: '目录不存在' };
    const stamp = String(opts.stamp || new Date().toISOString().replace(/[:.]/g, '-'));
    try {
        if (opts.purge) { fs.rmSync(dir, { recursive: true, force: true }); return { ok: true, mode: 'purge', id }; }
        const trash = path.join(extRoot, TRASH_DIR);
        fs.mkdirSync(trash, { recursive: true });
        const dst = path.join(trash, id + '.' + stamp);
        fs.renameSync(dir, dst);
        return { ok: true, mode: 'trash', id, to: dst };
    } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
}

export function listTrash(opts = {}) {
    const extRoot = extensionsRoot(opts.dataRoot || '');
    const trash = path.join(extRoot, TRASH_DIR);
    if (!fs.existsSync(trash)) return [];
    return fs.readdirSync(trash, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
        const dir = path.join(trash, e.name);
        const dot = e.name.lastIndexOf('.');
        return {
            name: e.name, dir, id: dot > 0 ? e.name.slice(0, dot) : e.name,
            stamp: dot > 0 ? e.name.slice(dot + 1) : '', bytes: dirSize(dir), files: walkFiles(dir).length,
        };
    }).sort((a, b) => String(b.name).localeCompare(String(a.name)));
}

export function restoreFromTrash(opts = {}) {
    const extRoot = extensionsRoot(opts.dataRoot || '');
    const name = String(opts.name || '');
    if (!name || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf('..') >= 0) return { ok: false, reason: '名称不合法' };
    const src = path.join(extRoot, TRASH_DIR, name);
    const id = name.slice(0, Math.max(0, name.lastIndexOf('.'))) || name;
    if (!isSafeExtId(id)) return { ok: false, reason: '无法解析原扩展 id' };
    if (!fs.existsSync(src)) return { ok: false, reason: '回收站里没有这条记录' };
    const dst = path.join(extRoot, id);
    if (fs.existsSync(dst)) return { ok: false, reason: '目标目录已存在（先处理它再还原）' };
    try { fs.renameSync(src, dst); return { ok: true, id, restored: dst }; }
    catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
}

export function settingsPath(dataRoot) { return path.join(dataRoot || '', 'default-user', 'settings.json'); }

/** 重置某个扩展的界面设置：先备份 settings.json，再删 extension_settings[id] */
export function resetExtensionSettings(opts = {}) {
    const dataRoot = opts.dataRoot, id = String(opts.id || '');
    if (!dataRoot || !isSafeExtId(id)) return { ok: false, reason: '参数不合法' };
    const file = settingsPath(dataRoot);
    if (!fs.existsSync(file)) return { ok: false, reason: 'settings.json 不存在（ST 还没写过设置？）' };
    let raw, json;
    try { raw = fs.readFileSync(file, 'utf8'); json = JSON.parse(raw); }
    catch (e) { return { ok: false, reason: 'settings.json 解析失败：' + String((e && e.message) || e) }; }
    const es = json.extension_settings;
    if (!es || !Object.prototype.hasOwnProperty.call(es, id)) return { ok: true, had: false, reason: '这个扩展本来就没有保存过设置' };
    const stamp = String(opts.stamp || new Date().toISOString().replace(/[:.]/g, '-'));
    const backup = file + '.shellbak-' + stamp;
    try {
        fs.writeFileSync(backup, raw, 'utf8');
        delete es[id];
        fs.writeFileSync(file, JSON.stringify(json, null, 4), 'utf8');
    } catch (e) { return { ok: false, reason: String((e && e.message) || e), backup }; }
    return { ok: true, had: true, backup };
}
