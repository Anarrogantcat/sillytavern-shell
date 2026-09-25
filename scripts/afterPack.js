import fs from 'node:fs';import path from 'node:path';import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
export default async function afterPack(context){
    const { appOutDir, packager } = context;
    // lite 构建跳过 ST 打包（审计 #7：lite 不应内置 ST）
    const lite = /[\\/](dist-electron-v3-lite|dist-electron-lite)[\\/]/.test(appOutDir) || String(packager?.appInfo?.productFilename || '').toLowerCase().includes('lite');
    if (lite) { console.log('[afterPack] Lite build — skipping SillyTavern bundle'); return; }
    const staging = path.resolve(__dirname, '../staging/sillytavern');
    const dest = path.join(appOutDir, 'resources/sillytavern');
    // 审计：原先缺 staging 或拷完不全都只打日志，full 包在「没有 ST / 少 node_modules」时照样构建成功，
    // 用户装完才发现打不开。这里改成硬失败，让电子构建直接红掉。
    if (!fs.existsSync(staging)) {
        throw new Error('[afterPack] full 构建缺少 staging/sillytavern（先跑 npm run st-prep）。若确实要出不含 ST 的包，请用 lite 配置。');
    }
    console.log('[afterPack] Copying SillyTavern...');
    copyDir(staging, dest);
    const ok = fs.existsSync(path.join(dest, 'server.js')) && fs.existsSync(path.join(dest, 'node_modules'));
    if (!ok) {
        throw new Error('[afterPack] SillyTavern 打包不完整：' + dest + ' 缺少 server.js 或 node_modules（full 包会不可用）');
    }
    console.log('[afterPack] SillyTavern bundled successfully');
}
function copyDir(src,dest){fs.mkdirSync(dest,{recursive:true});for(const e of fs.readdirSync(src,{withFileTypes:true})){const s=path.join(src,e.name),d=path.join(dest,e.name);e.isDirectory()?copyDir(s,d):fs.copyFileSync(s,d);}}
