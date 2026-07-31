import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        onMaximizeChange: cb => { const h = (_e, v) => cb(v); ipcRenderer.on('window:maximizeChange', h); return () => ipcRenderer.removeListener('window:maximizeChange', h); },
    },
    server: {
        onUrl: cb => { const h = (_e, u) => cb(u); ipcRenderer.on('server:url', h); return () => ipcRenderer.removeListener('server:url', h); },
        onError: cb => { const h = (_e, m) => cb(m); ipcRenderer.on('server:error', h); return () => ipcRenderer.removeListener('server:error', h); },
        onSetupStarted: cb => { const h = () => cb(); ipcRenderer.on('setup:started', h); return () => ipcRenderer.removeListener('setup:started', h); },
    },
    terminal: {
        onOutput: cb => { const h = (_e, t) => cb(t); ipcRenderer.on('terminal:output', h); return () => ipcRenderer.removeListener('terminal:output', h); },
        getHistory: () => ipcRenderer.invoke('terminal:getHistory'),
        exec: cmd => ipcRenderer.invoke('terminal:exec', cmd),
    },
    settings: {
        get: () => ipcRenderer.invoke('settings:get'),
        save: obj => ipcRenderer.invoke('settings:save', obj),
        getServerPath: () => ipcRenderer.invoke('settings:getServerPath'),
        setServerPath: p => ipcRenderer.invoke('settings:setServerPath', p),
        getDataRoot: () => ipcRenderer.invoke('settings:getDataRoot'),
    },
    app: { getVersion: () => ipcRenderer.invoke('app:getVersion'), getShellVersion: () => ipcRenderer.invoke('app:getShellVersion'), getChangelog: () => ipcRenderer.invoke('app:getChangelog') },
    update: {
        check: () => ipcRenderer.invoke('update:check'),
        updateSillyTavern: () => ipcRenderer.invoke('update:sillytavern'),
    },
    shellUpdate: {
        check: () => ipcRenderer.invoke('shell-update:check'),
        download: () => ipcRenderer.invoke('shell-update:download'),
        install: () => ipcRenderer.invoke('shell-update:install'),
        onProgress: cb => { const h = (_e, p) => cb(p); ipcRenderer.on('shell-update:progress', h); return () => ipcRenderer.removeListener('shell-update:progress', h); },
        onDownloaded: cb => { const h = () => cb(); ipcRenderer.on('shell-update:downloaded', h); return () => ipcRenderer.removeListener('shell-update:downloaded', h); },
        onError: cb => { const h = (_e, e) => cb(e); ipcRenderer.on('shell-update:error', h); return () => ipcRenderer.removeListener('shell-update:error', h); },
    },
});
