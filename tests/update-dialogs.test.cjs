const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const load = require('./load.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(platform = 'darwin', options = {}) {
    const timers = [], intervals = [], dialogs = [], external = [], logged = [];
    let updaterOptions, installed = 0, quits = 0, prepared = 0, launched = 0, fetches = 0;
    const app = { isPackaged: options.packaged !== false, getLocale: () => options.locale || 'en-US', getVersion: () => '1.0.4',
        getPath: () => '/users/data', getAppPath: () => '/client', quit() { quits++; } };
    const window = new EventEmitter(); window.hidden = false;
    Object.assign(window, { isDestroyed: () => false, isVisible: () => !window.hidden, isMinimized: () => false, setProgressBar() {} });
    const updater = new EventEmitter(); updater.quitAndInstall = () => { installed++; };
    const name = 'to-1.0.5-darwin-arm64.zip';
    const release = { tag_name: '1.0.5', html_url: 'https://github.com/AlanKaspersky/Tanki-Online-with-KI/releases/tag/1.0.5', draft: false, prerelease: false,
        assets: options.assets === false ? [] : [name, name + '.sha256'].map(name => ({ name, size: 100,
            browser_download_url: 'https://github.com/AlanKaspersky/Tanki-Online-with-KI/releases/download/1.0.5/' + name })) };
    const preparedUpdate = { version: '1.0.5' };
    const answers = [...(options.answers || [1])];
    const api = load('clientUpdates', {
        electron: { app, autoUpdater: updater, dialog: { async showMessageBox(_window, props) { dialogs.push(props); return { response: answers.shift() ?? 1 }; } },
            shell: { async openExternal(url) { external.push(url); } } },
        'electron-log/main': { warn: (...args) => logged.push(args) },
        'update-electron-app': { UpdateSourceType: { ElectronPublicUpdateService: 0 }, updateElectronApp(config) { updaterOptions = config; } },
        'node:fs': { existsSync: () => options.squirrel !== false },
        './macUpdates': {
            readPreparedMacUpdate: async () => options.pending ? preparedUpdate : null,
            prepareMacUpdate: async () => { prepared++; if (options.downloadError) throw Error('download failed'); return preparedUpdate; },
            launchMacInstaller: async () => { launched++; if (options.installError) throw Error('helper failed'); },
        },
    }, {
        process: { platform, arch: 'arm64', execPath: '/client/Tanki.app/Contents/MacOS/client' },
        setTimeout(fn) { timers.push(fn); return fn; }, clearTimeout() {}, setInterval(fn) { intervals.push(fn); return fn; }, clearInterval() {},
        fetch: async () => { fetches++; if (options.offline) throw Error('offline'); return { ok: true, body: (async function* () { yield Buffer.from(JSON.stringify(release)); })() }; },
    });
    const stop = api.startClientUpdates(window);
    return { window, dialogs, external, updater, release, logged, stop,
        async check() { if (timers[0]) await timers[0](); await tick(); await tick(); },
        async interval() { if (intervals[0]) await intervals[0](); await tick(); await tick(); },
        native: () => updaterOptions, counts: () => ({ installed, quits, prepared, launched, fetches }), timers };
}
test('development builds never schedule update checks or installation', async () => {
    const f = fixture('darwin', { packaged: false }); await f.check();
    assert.equal(f.timers.length, 0); assert.equal(f.counts().fetches, 0);
});
test('Windows retains native automatic updates and restarts only after explicit confirmation', async () => {
    const f = fixture('win32', { answers: [0] });
    assert.equal(f.native().notifyUser, true);
    assert.equal(f.native().updateSource.repo, 'AlanKaspersky/Tanki-Online-with-KI');
    f.native().onNotifyUser({}); await tick();
    assert.equal(f.counts().installed, 1);
    assert.equal(f.dialogs[0].cancelId, 1);
    const later = fixture('win32'); later.native().onNotifyUser({}); await tick();
    assert.equal(later.counts().installed, 0);
});
test('a downloaded Windows update waits while hidden and is offered on focus', async () => {
    const f = fixture('win32'); f.window.hidden = true; f.native().onNotifyUser({}); await tick();
    assert.equal(f.dialogs.length, 0);
    f.window.hidden = false; f.window.emit('focus'); await tick();
    assert.equal(f.dialogs.length, 1);
    f.window.emit('focus'); await tick(); assert.equal(f.dialogs.length, 1);
});
test('Mac downloads in the background and requires a second confirmation before quitting', async () => {
    const f = fixture('darwin', { answers: [0, 0], locale: 'ru-RU' }); await f.check();
    assert.equal(f.counts().prepared, 1); assert.equal(f.counts().launched, 1); assert.equal(f.counts().quits, 1);
    assert.equal(f.dialogs.length, 2); assert.equal(f.dialogs[0].buttons[0], 'Скачать обновление');
    assert.equal(f.dialogs[1].buttons[0], 'Обновить и перезапустить');
});
test('Later does not download or interrupt the game and does not prompt every hour', async () => {
    const f = fixture(); await f.check(); await f.interval();
    assert.equal(f.dialogs.length, 1); assert.equal(f.counts().prepared, 0); assert.equal(f.counts().quits, 0);
});
test('a prepared Mac update is reused after restart without downloading another ZIP', async () => {
    const f = fixture('darwin', { pending: true, answers: [1] }); await f.check();
    assert.equal(f.counts().fetches, 0); assert.equal(f.counts().prepared, 0); assert.equal(f.dialogs.length, 1);
    assert.equal(f.counts().quits, 0);
});
test('missing Mac ZIP assets and portable clients offer the release page without a bogus automatic install', async () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
        const f = fixture(platform, { assets: false, squirrel: false, answers: [0] }); await f.check();
        assert.equal(f.external.length, 1); assert.equal(f.counts().prepared, 0); assert.equal(f.counts().quits, 0);
        assert.equal(f.external[0], f.release.html_url);
    }
});
test('network, download and installer failures leave the client running', async () => {
    const offline = fixture('darwin', { offline: true }); await offline.check(); assert.equal(offline.dialogs.length, 0);
    const failed = fixture('darwin', { downloadError: true, answers: [0, 1] }); await failed.check();
    assert.equal(failed.counts().quits, 0); assert.equal(failed.counts().launched, 0); assert.equal(failed.dialogs.length, 2);
    const helper = fixture('darwin', { installError: true, pending: true, answers: [0] }); await helper.check();
    assert.equal(helper.counts().quits, 0); assert.ok(helper.logged.length);
});
test('closed windows stop scheduled Github checks and cannot trigger a deferred install', async () => {
    const f = fixture(); f.window.emit('closed'); await f.check(); await f.interval();
    assert.equal(f.counts().fetches, 0); assert.equal(f.dialogs.length, 0);
});
