// lib/ext-remote.js — 扩展「在线更新」通道（扩展版本与套壳版本解耦的关键）
// 思路：仓库里提交一份 extensions/index.json（每个扩展的版本 + 每个文件的 sha1）；
//       套壳拿这份清单跟本地已部署版本比对，落后就从 CDN 拉文件、逐个校验 sha1、再落地。
//       这样扩展改了不需要重新发整个套壳安装包 —— 老套壳也能拿到新扩展。
// 依赖注入：fetchText(url) => Promise<string>，便于在 Node 里用假实现做夹具测试。
import path from 'node:path';
import fs from 'node:fs';
import { compareVersions, readManifest, installFromPayload, verifyPayload, extensionsRoot } from './ext-deploy.js';

/**
 * 依次尝试的清单/文件根地址。顺序按【新鲜度】排（2026-09-20 实测响应头）：
 *   raw.githubusercontent.com → Cache-Control: max-age=300（5 分钟）
 *   testingcf.jsdelivr.net    → s-maxage=43200（12 小时，国内可达性更好）
 *   GitHub contents API       → 匿名 60 次/小时，实测本机已 403 rate limit，故不采用
 * 另外每个请求都带 ?t= 时间戳（缓存穿透），并且**每个扩展在多源之间重试**：
 * 源给的内容与清单 sha1 不符时会自动换下一个源，绝不把旧内容写进用户目录。
 */
export const DEFAULT_BASES = [
    'https://raw.githubusercontent.com/Anarrogantcat/sillytavern-shell/main/extensions',
    'https://testingcf.jsdelivr.net/gh/Anarrogantcat/sillytavern-shell@main/extensions',
];

/** 统一行尾：仓库 blob 是 LF，Windows 工作区可能是 CRLF —— 两边都先归一，哈希才对得上 */
export function normalizeText(s) { return String(s == null ? '' : s).split('\r\n').join('\n'); }

export function parseIndex(text) {
    try {
        const j = JSON.parse(normalizeText(text));
        if (j && j.schema === 1 && Array.isArray(j.extensions)) return j;
        return null;
    } catch (_) { return null; }
}

/** 本地 vs 清单：谁需要更新 */
export function planRemoteUpdates(index, dataRoot) {
    const rows = [];
    for (const e of (index && index.extensions) || []) {
        const dir = path.join(extensionsRoot(dataRoot), String(e.id));
        const mf = readManifest(dir);
        const cur = mf ? String(mf.version || '0') : '';
        if (!mf) rows.push({ id: e.id, from: cur, to: String(e.version), action: 'install' });
        else if (compareVersions(String(e.version), cur) > 0) rows.push({ id: e.id, from: cur, to: String(e.version), action: 'update' });
        else rows.push({ id: e.id, from: cur, to: String(e.version), action: 'skip' });
    }
    return rows;
}

/** 拉清单；逐个 base 试，全失败返回 ok:false（附带每个 base 的错误） */
export async function fetchIndex(opts = {}) {
    const fetchText = opts.fetchText;
    const bases = opts.bases || DEFAULT_BASES;
    const log = typeof opts.log === 'function' ? opts.log : () => {};
    const stamp = opts.stamp || Date.now();
    if (typeof fetchText !== 'function') return { ok: false, base: '', index: null, tried: [{ base: '-', error: '缺少 fetchText' }] };
    const tried = [];
    for (const b of bases) {
        // 清单必须最新 → 带时间戳穿透 CDN 缓存
        const url = b + '/index.json?t=' + stamp;
        try {
            const text = await fetchText(url);
            const idx = parseIndex(text);
            if (!idx) throw new Error('index.json 无法解析或 schema 不符');
            return { ok: true, base: b, index: idx, tried };
        } catch (e) {
            const msg = String((e && e.message) || e);
            tried.push({ base: b, error: msg });
            log('[ext] 清单获取失败 ' + url + ' ：' + msg);
        }
    }
    return { ok: false, base: '', index: null, tried };
}

/**
 * 按清单下载并安装更新的扩展。
 * 安全：先把该扩展的**全部文件**下齐并逐个校验 sha1，全部通过才写盘（避免半套文件）；
 *       写盘走 installFromPayload（同样会校验路径与哈希）。
 */
export async function applyRemoteUpdates(opts = {}) {
    const { index, dataRoot, fetchText, fetchBinary } = opts;
    const log = typeof opts.log === 'function' ? opts.log : () => {};
    const force = !!opts.force;
    const stamp = opts.stamp || Date.now();
    const result = { updated: [], skipped: [], failed: [] };
    if (!index || typeof fetchText !== 'function') { result.failed.push({ id: '-', reason: '缺少 index/fetchText' }); return result; }
    // 源顺序：opts.base（清单命中的那个）优先，其余按 DEFAULT_BASES 补齐 → 某个源内容陈旧/缺失时还能换源
    const bases = opts.bases || (opts.base ? [opts.base].concat(DEFAULT_BASES.filter((b) => b !== opts.base)) : DEFAULT_BASES);

    for (const row of planRemoteUpdates(index, dataRoot)) {
        if (row.action === 'skip' && !force) { result.skipped.push(row); continue; }
        const ext = (index.extensions || []).find((e) => e.id === row.id);
        if (!ext) continue;
        let lastErr = null, done = false;
        for (const base of bases) {
            const files = [];
            let err = null;
            for (const f of ext.files || []) {
                const url = base + '/' + ext.id + '/' + f.path + '?t=' + stamp;
                try {
                    if (f.bin) {
                        if (typeof fetchBinary !== 'function') throw new Error('该扩展含二进制文件，但没提供 fetchBinary');
                        const buf = await fetchBinary(url);
                        files.push({ path: f.path, content: Buffer.from(buf), sha1: f.sha1 });
                    } else {
                        files.push({ path: f.path, content: normalizeText(await fetchText(url)), sha1: f.sha1 });
                    }
                } catch (e) { err = '下载失败 ' + f.path + '：' + String((e && e.message) || e); break; }
            }
            if (!err) {
                const v = verifyPayload({ id: ext.id, version: ext.version, files });
                if (!v.ok) err = '校验不符（该源内容可能过期）：' + v.problems.slice(0, 3).join('；');
            }
            if (!err) {
                const r = installFromPayload({ id: ext.id, version: ext.version, files }, { dataRoot, log, force, now: opts.now });
                if (r.ok) { if (r.written) result.updated.push({ id: ext.id, from: row.from, to: String(ext.version) }); else result.skipped.push(row); done = true; break; }
                err = '写入失败：' + r.reason;
            }
            lastErr = err;
            log('[ext] ' + ext.id + ' 源失败 ' + base + ' → ' + err + '（换下一个源）');
        }
        if (!done && lastErr) result.failed.push({ id: ext.id, reason: lastErr });
    }
    return result;
}

/** 一句话摘要 */
export function summarizeRemote(result) {
    if (!result) return '';
    const up = (result.updated || []).map((u) => u.id + ' ' + (u.from ? u.from + '→' : '') + u.to);
    const parts = [];
    if (up.length) parts.push('已更新：' + up.join('、'));
    if ((result.failed || []).length) parts.push('失败：' + result.failed.map((f) => f.id + '(' + f.reason + ')').join('、'));
    if (!parts.length) parts.push('均为最新');
    return parts.join('；');
}
