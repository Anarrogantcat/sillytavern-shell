const { execSync } = require('child_process');
const fs = require('fs');
// Extract the v1.6.7 checkShellUpdate function from repo shell.js
const src = fs.readFileSync('D:/AI/sillytavern-shell/shell.js', 'utf8');
const start = src.indexOf('async function checkShellUpdate');
const end = src.indexOf('\n// ', start + 10);
if (start < 0) { console.log('START NOT FOUND'); process.exit(1); }
const fn = src.slice(start, end > start ? end : undefined);
// trim trailing partial line
const trimmed = fn.split('\n').filter(l => !/^}$/.test(l) || l.trim() === '}').join('\n');
console.log('FN_LEN:', trimmed.length);
console.log('HAS_AUTO_INSTALL:', trimmed.includes("setTimeout(()=>SU.install(),800)"));
console.log('HAS_DONE_GUARD:', trimmed.includes("if(dl.dataset.done)return;"));
fs.writeFileSync('D:/AI/st-fix/shell.js.fn', trimmed);
console.log('saved to D:/AI/st-fix/shell.js.fn');
