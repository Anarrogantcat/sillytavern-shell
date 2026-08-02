// Reproduce the integrity-check script exactly as shell.js runs it
const { execSync } = require('child_process');
const cwd = 'D:/AI/SillyTavern/SillyTavern';

const script = `const fs=require('fs');const git=require('child_process').execSync('git rev-parse --is-inside-work-tree',{stdio:'pipe'}).toString().trim()==='true';const out=[];if(git){const del=require('child_process').execSync('git ls-files --deleted',{stdio:'pipe'}).toString().trim().split('\\n').filter(l=>l&&!l.startsWith('data/'));del.forEach(l=>out.push('MISSING '+l));}else{['server.js','package.json','public/index.html'].forEach(f=>{if(!fs.existsSync(f))out.push('MISSING '+f);});}if(!fs.existsSync('node_modules'))out.push('MISSING node_modules');console.log(JSON.stringify({git,out}));`;

try {
    const out = execSync(`node -e "${script.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf8', timeout: 30000 });
    console.log('STDOUT:', out.trim());
} catch (e) {
    console.log('EXEC ERROR:');
    console.log('  message:', e.message?.slice(0, 300));
    console.log('  stdout:', e.stdout?.toString()?.slice(0, 200));
    console.log('  stderr:', e.stderr?.toString()?.slice(0, 500));
}
