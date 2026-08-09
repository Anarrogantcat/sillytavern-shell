// webview-preload.js — runs inside the SillyTavern page.
// Reports Ctrl+wheel / pinch gestures to the host shell, which applies
// viewport-level zoom via webview.setZoomFactor() (browser-like zoom).
const { ipcRenderer } = require('electron');

let last = 0;

window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const now = Date.now();
    if (now - last < 80) return; // throttle: max ~12 msgs/sec
    last = now;
    ipcRenderer.sendToHost('zoom-wheel', e.deltaY > 0 ? -1 : 1);
}, { passive: false });

// Right-click: report position + selection state to the host so it can
// show a context menu (Electron webview has no default context menu).
window.addEventListener('contextmenu', (e) => {
    let hasSelection = false;
    try {
        const s = window.getSelection();
        hasSelection = !!(s && s.toString() && s.toString().trim());
    } catch (_) {}
    ipcRenderer.sendToHost('ctxmenu', { x: e.clientX, y: e.clientY, hasSelection });
});
