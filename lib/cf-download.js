// 作者：小肥鱼（DeepSeek V4 Flash）· 染喵 ｜ 许可：AGPL-3.0 ｜ 项目：https://github.com/Anarrogantcat/sillytavern-shell
// cloudflared 按需下载（纯 node：fs/crypto + 注入的 fetch → 主进程传 Electron 的 net.fetch，测试传 Node fetch）
// 校验策略：体积 >= 20MB + PE（MZ）头 + sha256 记录到 meta.json（下次启动比对，检测损坏/被替换）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CF_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
export const MIN_BYTES = 20 * 1024 * 1024;

/** 基本健全性检查：体积够大且是 PE（MZ）开头 —— 防半截文件 / HTML 错误页被当成 exe */
export function exeOk(file) {
    try {
        const st = fs.statSync(file);
        if (st.size < MIN_BYTES) return false;
        const buf = Buffer.alloc(2);
        const fd = fs.openSync(file, 'r');
        fs.readSync(fd, buf, 0, 2, 0);
        fs.closeSync(fd);
        return buf[0] === 0x4d && buf[1] === 0x5a;
    } catch (_) { return false; }
}

export function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function readMeta(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'cloudflared.meta.json'), 'utf8')); } catch (_) { return null; }
}

/**
 * 确保 cloudflared.exe 就绪（已存在且哈希一致就直接复用）
 * @param {{dir:string, url?:string, fetchImpl?:Function, log?:Function, onProgress?:Function}} opts
 * @returns {Promise<{ok:boolean, path?:string, sha256?:string, bytes?:number, reused?:boolean, error?:string}>}
 */
export async function downloadCloudflared(opts = {}) {
    const dir = String(opts.dir || '');
    const url = String(opts.url || CF_URL);
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const log = typeof opts.log === 'function' ? opts.log : () => {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    if (!dir) return { ok: false, error: '缺少目标目录' };
    if (typeof fetchImpl !== 'function') return { ok: false, error: '没有可用的 fetch' };
    const exe = path.join(dir, 'cloudflared.exe');
    const part = exe + '.part';
    if (exeOk(exe)) {
        const meta = readMeta(dir);
        if (!meta || !meta.sha256) return { ok: true, path: exe, reused: true, sha256: '', bytes: fs.statSync(exe).size };
        const got = sha256File(exe);
        if (got === meta.sha256) return { ok: true, path: exe, reused: true, sha256: got, bytes: fs.statSync(exe).size };
        log('[cf] 本地 cloudflared 与本机记录的哈希不符，重新下载');
    }
    try {
        fs.mkdirSync(dir, { recursive: true });
        log('[cf] 开始下载 ' + url);
        const res = await fetchImpl(url, { redirect: 'follow' });
        if (!res || !res.ok || !res.body) throw new Error('HTTP ' + (res ? res.status : '?'));
        const total = Number((res.headers && res.headers.get) ? (res.headers.get('content-length') || 0) : 0);
        const ws = fs.createWriteStream(part);
        let got = 0;
        const reader = res.body.getReader();
        for (;;) {
            const step = await reader.read();
            if (step.done) break;
            const chunk = Buffer.from(step.value);
            got += chunk.length;
            if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
            onProgress(got, total);
        }
        await new Promise((r) => ws.end(r));
        if (!exeOk(part)) throw new Error('下载内容不是有效的 cloudflared.exe（' + got + ' 字节）');
        const sum = sha256File(part);
        try { fs.rmSync(exe, { force: true }); } catch (_) {}
        fs.renameSync(part, exe);
        fs.writeFileSync(path.join(dir, 'cloudflared.meta.json'), JSON.stringify({ url, sha256: sum, bytes: got, at: new Date().toISOString() }, null, 2), 'utf8');
        log('[cf] 完成：' + exe + '（' + got + ' 字节）');
        return { ok: true, path: exe, sha256: sum, bytes: got, reused: false };
    } catch (e) {
        try { fs.rmSync(part, { force: true }); } catch (_) {}
        return { ok: false, error: String((e && e.message) || e) };
    }
}
