const fs = require('fs');
const local = 'D:/AI/st-fix/shell.js';
const fnPath = 'D:/AI/st-fix/shell.js.fn';
let src = fs.readFileSync(local, 'utf8');
const newFn = fs.readFileSync(fnPath, 'utf8').trim();

const startIdx = src.indexOf('async function checkShellUpdate');
if (startIdx < 0) { console.log('START NOT FOUND'); process.exit(1); }
// find end: the closing brace of the function. Strategy: scan from startIdx,
// track brace depth; end at first depth-0 '}' that ends the function.
let depth = 0, endIdx = -1;
for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
        depth--;
        if (depth === 0) { endIdx = i + 1; break; }
    }
}
if (endIdx < 0) { console.log('END NOT FOUND'); process.exit(1); }
const oldFn = src.slice(startIdx, endIdx);
console.log('old fn len:', oldFn.length, '| has auto-install:', oldFn.includes('setTimeout(()=>SU.install'));

const before = src.slice(0, startIdx);
const after = src.slice(endIdx);
// ensure after starts with newline
const newContent = before + newFn + '\n' + after.replace(/^\n+/, '\n');
fs.writeFileSync(local, newContent);
console.log('REPLACED. new file len:', newContent.length);

// verify
const check = fs.readFileSync(local, 'utf8');
console.log('verify auto-install:', check.includes('setTimeout(()=>SU.install(),800)'));
console.log('verify done guard:', check.includes('if(dl.dataset.done)return;'));
console.log('verify old text gone:', !check.includes('✅ 更新已下载！'));
