const fs = require('fs');
const html = fs.readFileSync('shell.html', 'utf8');
const js = fs.readFileSync('shell.js', 'utf8');
const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const jsIds = [...js.matchAll(/\$\(['"]#([^'"]+)['"]\)/g)].map(m => m[1]);
const missing = jsIds.filter(id => !htmlIds.includes(id));
console.log('HTML ids:', htmlIds.length, '| JS refs:', jsIds.length);
console.log('JS 引用但 HTML 不存在的 id:', missing.length ? missing : '无 ✓');
