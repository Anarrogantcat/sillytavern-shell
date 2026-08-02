// Reproduce user scenario: v1.6.5 app → GitHub provider → download v1.6.6 (201MB real)
// Usage: electron scripts/test-updater-github.cjs
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.forceDevUpdateConfig = true;
autoUpdater.currentVersion = '1.6.5'; // simulate the installed v1.6.5 (string — internally re-parsed)
// real GitHub provider — same as packaged app config
autoUpdater.setFeedURL({ provider: 'github', owner: 'Anarrogantcat', repo: 'sillytavern-shell' });
autoUpdater.logger = console;

app.whenReady().then(async () => {
    console.log('[test] app version (simulated):', app.getVersion());
    autoUpdater.on('checking-for-update', () => console.log('[EVENT] checking-for-update'));
    autoUpdater.on('update-available', i => console.log('[EVENT] update-available', i.version));
    autoUpdater.on('update-not-available', () => console.log('[EVENT] update-not-available'));
    autoUpdater.on('download-progress', p => console.log('[EVENT] progress', Math.round(p.percent), '%'));
    autoUpdater.on('update-downloaded', i => console.log('[EVENT] update-downloaded', i.version, 'files:', i.files?.map(f => f.url).join(',')));
    autoUpdater.on('error', (e, msg) => console.log('[EVENT] error:', e?.message || e, '|', msg));
    try {
        console.log('[test] checking GitHub...');
        const r = await autoUpdater.checkForUpdates();
        console.log('[test] check result:', r?.updateInfo?.version);
        console.log('[test] downloading 201MB real package...');
        await autoUpdater.downloadUpdate();
        console.log('[test] downloadUpdate resolved');
        console.log('[test] installerPath:', autoUpdater.installerPath);
        setTimeout(() => { console.log('[test] done. exiting.'); app.exit(0); }, 1500);
    } catch (e) {
        console.log('[test] CATCH:', e.message);
        app.exit(1);
    }
});
