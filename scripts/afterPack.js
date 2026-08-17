import fs from 'node:fs';import path from 'node:path';import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
export default async function afterPack(context){
    const { appOutDir, packager } = context;
    // lite 构建跳过 ST 打包（审计 #7：lite 不应内置 ST）
    const lite = /[\\/](dist-electron-v3-lite|dist-electron-lite)[\\/]/.test(appOutDir) || String(packager?.appInfo?.productFilename || '').toLowerCase().includes('lite');
    if (lite) { console.log('[afterPack] Lite build — skipping SillyTavern bundle'); return; }
    const staging = path.resolve(__dirname, '../staging/sillytavern');
    const dest = path.join(appOutDir, 'resources/sillytavern');
    if (!fs.existsSync(staging)) { console.log('[afterPack] Staging not found, skipping'); return; }
    console.log('[afterPack] Copying SillyTavern...');
    copyDir(staging, dest);
    const ok = fs.existsSync(path.join(dest, 'server.js')) && fs.existsSync(path.join(dest, 'node_modules'));
    console.log(ok ? '[afterPack] SillyTavern bundled successfully' : '[afterPack] WARNING: Incomplete bundle!');
}
function copyDir(src,dest){fs.mkdirSync(dest,{recursive:true});for(const e of fs.readdirSync(src,{withFileTypes:true})){const s=path.join(src,e.name),d=path.join(dest,e.name);e.isDirectory()?copyDir(s,d):fs.copyFileSync(s,d);}}
