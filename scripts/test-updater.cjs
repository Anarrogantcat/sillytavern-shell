// Test electron-updater event chain against a local generic server.
// Usage: electron test-updater.cjs   (server: node scripts/test-upd-server.cjs)
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.forceDevUpdateConfig = true; // allow update checks in dev mode for testing
autoUpdater.setFeedURL({ provider: 'generic', url: 'http://127.0.0.1:8899/' });
autoUpdater.logger = console;

app.whenReady().then(async () => {
    console.log('[test] app ready, current version:', app.getVersion());
    autoUpdater.on('checking-for-update', () => console.log('[EVENT] checking-for-update'));
    autoUpdater.on('update-available', i => console.log('[EVENT] update-available', i.version));
    autoUpdater.on('update-not-available', () => console.log('[EVENT] update-not-available'));
    autoUpdater.on('download-progress', p => console.log('[EVENT] progress', Math.round(p.percent), '%'));
    autoUpdater.on('update-downloaded', i => console.log('[EVENT] update-downloaded', i.version, 'files:', i.files?.map(f => f.url).join(',')));
    autoUpdater.on('error', (e, msg) => console.log('[EVENT] error:', e?.message || e, '|', msg));
    try {
        console.log('[test] checking...');
        const r = await autoUpdater.checkForUpdates();
        console.log('[test] check result:', r?.updateInfo?.version);
        console.log('[test] downloading...');
        await autoUpdater.downloadUpdate();
        console.log('[test] downloadUpdate resolved (await returned)');
        console.log('[test] installerPath:', autoUpdater.installerPath);
        setTimeout(() => { console.log('[test] done. exiting.'); app.exit(0); }, 1500);
    } catch (e) {
        console.log('[test] CATCH:', e.message);
        app.exit(1);
    }
});
