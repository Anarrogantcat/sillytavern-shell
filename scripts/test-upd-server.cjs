// Local generic update server for testing electron-updater event chain.
// Serves latest.yml + a small fake installer exe on port 8899.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '.smoke', 'upd');
fs.mkdirSync(DIR, { recursive: true });

// fake installer: 5MB of bytes (version must be HIGHER than electron's 41.x)
const exePath = path.join(DIR, 'SillyTavern-Setup-99.9.9.exe');
if (!fs.existsSync(exePath)) {
    const buf = Buffer.alloc(5 * 1024 * 1024, 0xAB);
    fs.writeFileSync(exePath, buf);
}
const size = fs.statSync(exePath).size;
const sha512 = crypto.createHash('sha512').update(fs.readFileSync(exePath)).digest('base64');
const yml = `version: 99.9.9
files:
  - url: SillyTavern-Setup-99.9.9.exe
    sha512: ${sha512}
    size: ${size}
path: SillyTavern-Setup-99.9.9.exe
sha512: ${sha512}
releaseDate: '2026-08-02T10:00:00.000Z'
`;
fs.writeFileSync(path.join(DIR, 'latest.yml'), yml);
console.log('latest.yml served with version 99.9.9, size', size);

const server = http.createServer((req, res) => {
    const f = path.join(DIR, req.url.split('?')[0].replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        fs.createReadStream(f).pipe(res);
        console.log('SERVED', req.url);
    } else {
        res.writeHead(404); res.end('not found');
        console.log('404', req.url);
    }
});
server.listen(8899, '127.0.0.1', () => console.log('update server on http://127.0.0.1:8899'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
