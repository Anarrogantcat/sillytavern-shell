const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const jsFiles = ['index.js', 'preload.js', 'shell.js', 'scripts/prebuild.js', 'scripts/afterPack.js', 'scripts/gen-icon.js'];
let fail = 0;

console.log('=== JS syntax ===');
for (const f of jsFiles) {
    try { execSync(`node --check "${path.join(dir, f)}"`, { stdio: 'pipe' }); console.log(`OK  ${f}`); }
    catch (e) { fail++; console.log(`ERR ${f}: ${e.message}`); }
}

console.log('=== JSON validity ===');
for (const f of ['package.json', 'electron-builder-lite.json']) {
    try { JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); console.log(`OK  ${f}`); }
    catch (e) { fail++; console.log(`ERR ${f}: ${e.message}`); }
}

console.log('=== Version sync check ===');
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const v = pkg.version;
const html = fs.readFileSync(path.join(dir, 'shell.html'), 'utf8');
const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
console.log(`package.json: ${v}`);
console.log(`shell.html  : ${html.includes('v' + v) ? 'OK' : 'MISMATCH (found v' + (html.match(/v\d+\.\d+[.\w-]*/) || ['?'])[0] + ')'}`);
console.log(`CHANGELOG   : ${changelog.includes('## v' + v) ? 'OK' : 'MISMATCH'}`);

console.log('=== Critical deps ===');
const deps = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies || {};
for (const d of ['electron-updater']) console.log(`${d}: ${deps[d] || 'MISSING!'}`);

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECKS FAILED`);
process.exit(fail === 0 ? 0 : 1);
