const { execSync } = require('child_process');
// Extract v1.6.5 shell.js and print the update-related portion
const src = execSync('git show v1.6.5:shell.js', { cwd: 'D:/AI/sillytavern-shell', encoding: 'utf8' });
const i = src.indexOf('async function checkShellUpdate');
if (i < 0) { console.log('not found'); process.exit(1); }
console.log(src.slice(i, i + 2200));
