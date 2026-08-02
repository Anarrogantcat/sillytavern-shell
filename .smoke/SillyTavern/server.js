// Fake SillyTavern server for GUI smoke tests (CJS isolated dir).
// MUST print "Go to: <url>" — index.js startServer() matches that pattern
// to discover the server URL and push it to the shell webview.
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Fake ST</title></head><body>fake</body></html>');
});
server.listen(8765, '127.0.0.1', () => {
    console.log('SillyTavern server listening on http://127.0.0.1:8765');
    console.log('Go to: http://127.0.0.1:8765');
});
process.on('SIGTERM', () => { server.close(); process.exit(0); });
