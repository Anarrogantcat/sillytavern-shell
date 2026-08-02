import fs from 'node:fs';import path from 'node:path';import { execSync } from 'node:child_process';import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR=path.resolve(__dirname,'..'),STAGING=path.join(ELECTRON_DIR,'staging/sillytavern');
const SKIP_DIRS=new Set(['node_modules','.git','backups','data','config.yaml','dist-electron','dist-electron-v3','dist-electron-lite','dist-electron-v3-lite','dist-electron-lite-tmp','src/electron','staging','.github','.vscode','.gemini','colab']);
const HEAD_FILE=path.join(STAGING,'.git-head');

// Resolve SillyTavern source root: --st-root arg > ST_ROOT env > sibling dirs. Never a drive root.
const argIdx=process.argv.indexOf('--st-root');
const envRoot=process.env.ST_ROOT;
const siblingCandidates=[path.resolve(ELECTRON_DIR,'../SillyTavern'),path.resolve(ELECTRON_DIR,'../../SillyTavern'),path.resolve(ELECTRON_DIR,'../SillyTavern/SillyTavern')];
let ROOT=(argIdx!==-1&&process.argv[argIdx+1])?path.resolve(process.argv[argIdx+1]):(envRoot?path.resolve(envRoot):'');
if(!ROOT){ROOT=siblingCandidates.find(p=>fs.existsSync(path.join(p,'server.js')))||'';}
const isDriveRoot=p=>path.parse(p).root===p;
if(!ROOT||!fs.existsSync(path.join(ROOT,'server.js'))||isDriveRoot(ROOT)){
  console.error('ERROR: SillyTavern source not found. Pass --st-root <path>, set ST_ROOT, or place the repo next to a SillyTavern dir (server.js required).');
  process.exit(1);
}
console.log(`ST source root: ${ROOT}`);

function gitHead(dir){try{return execSync('git rev-parse HEAD',{cwd:dir,stdio:'pipe'}).toString().trim();}catch(_){return '';}}
const head=gitHead(ROOT);
const cachedHead=fs.existsSync(HEAD_FILE)?fs.readFileSync(HEAD_FILE,'utf8').trim():'';
const cacheOk=fs.existsSync(path.join(STAGING,'server.js'))&&fs.existsSync(path.join(STAGING,'node_modules'))&&head!==''&&head===cachedHead;

if(cacheOk){
  console.log('Staging cache hit (ST source unchanged) — skipping copy & npm install');
}else{
  console.log('Preparing SillyTavern staging...');
  fs.rmSync(path.join(ELECTRON_DIR,'staging'),{recursive:true,force:true});fs.mkdirSync(STAGING,{recursive:true});
  function copyDir(src,dest){fs.mkdirSync(dest,{recursive:true});for(const e of fs.readdirSync(src,{withFileTypes:true})){if(SKIP_DIRS.has(e.name))continue;const s=path.join(src,e.name),d=path.join(dest,e.name);e.isDirectory()?copyDir(s,d):fs.copyFileSync(s,d);}}
  copyDir(ROOT,STAGING);
  console.log('Installing production dependencies in staging...');
  execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error --no-progress',{cwd:STAGING,stdio:'inherit'});
  if(head!=='')fs.writeFileSync(HEAD_FILE,head);
}
const serverJs=path.join(STAGING,'server.js');
if(!fs.existsSync(serverJs)){console.error('ERROR: server.js not found!');process.exit(1);}
let total=0;function getSize(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?getSize(p):total+=fs.statSync(p).size;}}getSize(STAGING);
console.log(`Staging ready: ${(total/1024/1024).toFixed(1)} MB`);
