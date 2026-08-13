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

// B1 全局快捷键转发：webview 内的按键不会冒泡到宿主，转发 Ctrl+Shift 组合键
window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.shiftKey) return;
    if (['T', 'R', 'L'].includes(e.key.toUpperCase())) {
        ipcRenderer.sendToHost('hotkey', e.key.toUpperCase());
    }
});
