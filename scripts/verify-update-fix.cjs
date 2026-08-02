const fs = require('fs');
const { execSync } = require('child_process');
const t = fs.readFileSync('shell.js', 'utf8');
const count = s => t.split(s).length - 1;
console.log('checkShellUpdate 定义:', count('async function checkShellUpdate'));
console.log('dataset.done 出现:', count('dataset.done'));
console.log('SU.install 出现:', count('SU.install'));
console.log('onDownloaded 出现:', count('onDownloaded'));
console.log('文件长度:', t.length);
try { execSync('node --check shell.js', { stdio: 'pipe' }); console.log('语法: OK'); }
catch (e) { console.log('语法: FAIL —', e.stderr?.toString().split('\n').slice(0, 3).join(' ')); }
