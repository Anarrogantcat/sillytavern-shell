// Fake SillyTavern server for GUI smoke tests (CJS isolated dir).
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Fake ST</title></head><body>fake</body></html>');
});
server.listen(8765, '127.0.0.1', () => {
    console.log('SillyTavern server listening on http://127.0.0.1:8765');
    console.log('SERVER_READY');
});
