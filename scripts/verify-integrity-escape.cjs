// Verify the embedded integrity script's escaping is correct (produces working JS)
const fs = require('fs');
const src = fs.readFileSync('D:/AI/sillytavern-shell/shell.js', 'utf8');
const m = src.match(/const script=`([\s\S]*?)`;/);
if (!m) { console.log('SCRIPT NOT FOUND'); process.exit(1); }
const scriptSrc = m[1];
console.log('script length:', scriptSrc.length);
// Reconstruct what node -e actually receives (template literal already evaluated by shell.js,
// so scriptSrc IS the JS code string; the .replace(/"/g,'\\"') only escapes quotes for shell)
// Check the split('\\n') part: in the final JS it must be split('\n') — i.e. source contains split('\\n')
const hasCorrectSplit = scriptSrc.includes("split('\\\\n')");
console.log("has split('\\\\n') in script source:", hasCorrectSplit);
// Write the reconstructed script to a temp file and run it
const execSync = require('child_process').execSync;
try {
    const out = execSync(`node -e "${scriptSrc.replace(/"/g, '\\"')}"`, { cwd: 'D:/AI/SillyTavern/SillyTavern', encoding: 'utf8', timeout: 30000 });
    console.log('RUN OK:', out.trim());
} catch (e) {
    console.log('RUN FAIL:', (e.stderr || e.message).toString().slice(0, 300));
}
