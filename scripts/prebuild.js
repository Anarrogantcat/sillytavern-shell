import fs from 'node:fs';import path from 'node:path';import { execSync } from 'node:child_process';import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,'../../..'),ELECTRON_DIR=path.resolve(__dirname,'..'),STAGING=path.join(ELECTRON_DIR,'staging/sillytavern');
const SKIP_DIRS=new Set(['node_modules','.git','backups','data','config.yaml','dist-electron','dist-electron-v3','dist-electron-lite','dist-electron-v3-lite','dist-electron-lite-tmp','src/electron','staging','.github','.vscode','.gemini','colab']);
console.log('Preparing SillyTavern staging...');
fs.rmSync(path.join(ELECTRON_DIR,'staging'),{recursive:true,force:true});fs.mkdirSync(STAGING,{recursive:true});
function copyDir(src,dest){fs.mkdirSync(dest,{recursive:true});for(const e of fs.readdirSync(src,{withFileTypes:true})){if(SKIP_DIRS.has(e.name))continue;const s=path.join(src,e.name),d=path.join(dest,e.name);e.isDirectory()?copyDir(s,d):fs.copyFileSync(s,d);}}
copyDir(ROOT,STAGING);
console.log('Installing production dependencies in staging...');
execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error --no-progress',{cwd:STAGING,stdio:'inherit'});
const serverJs=path.join(STAGING,'server.js');
if(!fs.existsSync(serverJs)){console.error('ERROR: server.js not found!');process.exit(1);}
let total=0;function getSize(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?getSize(p):total+=fs.statSync(p).size;}}getSize(STAGING);
console.log(`Staging ready: ${(total/1024/1024).toFixed(1)} MB`);
