// Static checks: HTML div balance, duplicate ids, shell.js variable conflicts
const fs = require('fs');
const h = fs.readFileSync('D:/AI/sillytavern-shell/shell.html', 'utf8');
const open = (h.match(/<div/g) || []).length;
const close = (h.match(/<\/div>/g) || []).length;
console.log('HTML div open:', open, 'close:', close, open === close ? '✓ 配对' : '✗ 不配对');
const ids = (h.match(/id="[^"]+"/g) || []).map(s => s.slice(4, -1));
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log('重复 id:', dup.length ? dup.join(', ') : '无');
console.log('bench 相关 id:', ids.filter(x => /bench/.test(x)).join(', '));

const js = fs.readFileSync('D:/AI/sillytavern-shell/shell.js', 'utf8');
const conflicts = ['const B', 'let B', 'var B', 'function B', ' B='];
for (const c of conflicts) {
    const re = new RegExp(c.replace('B', '\\bB'), 'g');
    const m = js.match(re);
    if (m) console.log('shell.js 冲突嫌疑:', c, '→', m.length, '处');
}
// check benchEl element ids all exist in html
const benchRefs = [...js.matchAll(/\$\(['"]#([\w-]+)['"]\)/g)].map(m => m[1]).filter(x => x.includes('bench'));
const missing = benchRefs.filter(x => !ids.includes(x));
console.log('shell.js 引用的 bench id:', [...new Set(benchRefs)].join(', '));
console.log('缺失的 id:', missing.length ? missing.join(', ') : '无');
