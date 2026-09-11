import { contextBridge, ipcRenderer } from 'electron';

function readQuery() {
    try {
        const params = new URLSearchParams(window.location.search);
        return {
            message: params.get('message') || '',
            defaultValue: params.get('defaultValue') || '',
        };
    } catch (_) {
        return { message: '', defaultValue: '' };
    }
}

contextBridge.exposeInMainWorld('promptAPI', {
    get: () => readQuery(),
    done: (value) => ipcRenderer.send('prompt-result', value === null || value === undefined ? null : String(value)),
});
