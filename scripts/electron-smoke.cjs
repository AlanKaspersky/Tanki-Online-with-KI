const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { installGameAttention } = require('../build/gameAttention.js');
const { gameDOM } = require('../build/gameDOM.js');
const { gameWebPreferences } = require('../build/gameWindow.js');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-electron-smoke-'));
app.setPath('userData', profile);
let window;
const timeout = setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
    assert.equal(process.versions.electron, '44.8.0');
    session.defaultSession.protocol.handle('https', () => new Response('<!doctype html><html lang="en"><head></head><body><div class="MainScreenComponentStyle-blockMainMenu"></div></body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const extension = process.env.KI_TEST_EXTENSION_PATH;
    if (extension) await session.defaultSession.extensions.loadExtension(extension);
    window = new BrowserWindow({ show: false, opacity: 0, skipTaskbar: true, focusable: false,
        webPreferences: gameWebPreferences(path.resolve(__dirname, '../build/preload.js')) });
    assert.equal(window.webContents.getBackgroundThrottling(), false);
    // A real minimized window, transparent and absent from the taskbar; no focus stealing.
    const attentionFlashes = [];
    const nativeFlash = window.flashFrame.bind(window);
    window.flashFrame = value => { attentionFlashes.push(value); nativeFlash(value); };
    let stopAttention = installGameAttention(window, ipcMain, console.info, process.platform);
    let backgroundProgress;
    const ipc = new Promise(resolve => ipcMain.on('ki:discord-presence', (_event, value) => {
        if (value?.details === 'Smoke test') resolve(value);
    }));
    await window.loadURL('https://tankionline.com/play/');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const state = await window.webContents.executeJavaScript(`({
        isolated: typeof require === 'undefined' && typeof process === 'undefined' && typeof window.ipcRenderer === 'undefined',
        injector: typeof window.__kaspArcadeReloadDebug?.status === 'function',
        content: document.documentElement.style.getPropertyValue('--kasp-loader-bg')
    })`);
    assert.equal(state.isolated, true);
    if (extension) { assert.equal(state.injector, true, 'KI MAIN-world injector must load'); assert.ok(state.content.includes('chrome-extension://'), 'KI isolated content script must load'); }
    await window.webContents.executeJavaScript(`window.postMessage({type:'kasp:discord-presence',version:1,presence:{details:'Smoke test',state:'Test'}},location.origin)`);
    const value = await ipc;
    assert.equal(value.details, 'Smoke test');
    if (process.platform === 'win32') {
        const waitForState = (key, expected) => new Promise(resolve => {
            const listener = (_event, value) => {
                if (value?.[key] === expected) { ipcMain.removeListener('ki:game-attention', listener); resolve(); }
            };
            ipcMain.on('ki:game-attention', listener);
        });
        let changed = waitForState('searching', true);
        await window.webContents.executeJavaScript(`{
            const el=document.createElement('div');el.className=${JSON.stringify(gameDOM.attention.searching.slice(1))};
            el.style.cssText='width:20px;height:20px';document.body.append(el);
        }`);
        await changed;
        await window.webContents.executeJavaScript(`{
            window.__backgroundProgress={frames:0,ticks:0};
            const frame=()=>{window.__backgroundProgress.frames++;requestAnimationFrame(frame)};
            requestAnimationFrame(frame);setInterval(()=>window.__backgroundProgress.ticks++,100);
        }`);
        window.setIgnoreMouseEvents(true);
        window.showInactive();
        await new Promise(resolve => setTimeout(resolve, 100));
        const minimized = new Promise(resolve => window.once('minimize', resolve));
        window.minimize();
        await minimized;
        assert.equal(window.isMinimized(), true, 'Native window must really be minimized');
        await new Promise(resolve => setTimeout(resolve, 300));
        const before = await window.webContents.executeJavaScript('({...window.__backgroundProgress})');
        await new Promise(resolve => setTimeout(resolve, 1500));
        const after = await window.webContents.executeJavaScript('({...window.__backgroundProgress,visibility:document.visibilityState})');
        backgroundProgress = { frames: after.frames-before.frames, ticks: after.ticks-before.ticks, visibility: after.visibility };
        assert.ok(backgroundProgress.frames > 0, 'Animation frames must advance while minimized');
        assert.ok(backgroundProgress.ticks > 0, 'Timers must advance while minimized');
        changed = waitForState('loading', true);
        await window.webContents.executeJavaScript(`{
            setTimeout(()=>{
                document.querySelector(${JSON.stringify(gameDOM.attention.searching)}).remove();
                const el=document.createElement('div');el.className=${JSON.stringify(gameDOM.attention.loading.slice(1))};
                el.style.cssText='width:20px;height:20px';document.body.append(el);
            },250);
        }`);
        await changed;
        assert.deepEqual(attentionFlashes, [true]);
        const restored = new Promise(resolve => window.once('restore', resolve));
        window.restore();
        await restored;
        assert.equal(window.isFocused(), false);
        assert.deepEqual(attentionFlashes, [true], 'Restore without focus must keep attention');
        const restoredBefore = await window.webContents.executeJavaScript('window.__backgroundProgress.frames');
        await new Promise(resolve => setTimeout(resolve, 200));
        const restoredAfter = await window.webContents.executeJavaScript('window.__backgroundProgress.frames');
        backgroundProgress.restoredFrames = restoredAfter-restoredBefore;
        assert.ok(backgroundProgress.restoredFrames > 0, 'Frames must also advance after restoring');
        stopAttention();
        assert.deepEqual(attentionFlashes, [true, false]);
        stopAttention = installGameAttention(window, ipcMain, console.info, process.platform);
        assert.equal(window.isMinimized(), false);
        assert.equal(window.isFocused(), false);
        changed = waitForState('searching', true);
        await window.webContents.executeJavaScript(`{
            document.querySelector(${JSON.stringify(gameDOM.attention.loading)}).remove();
            const el=document.createElement('div');el.className=${JSON.stringify(gameDOM.attention.searching.slice(1))};
            el.style.cssText='width:20px;height:20px';document.body.append(el);
        }`);
        await changed;
        changed = waitForState('loading', true);
        await window.webContents.executeJavaScript(`{
            document.querySelector(${JSON.stringify(gameDOM.attention.searching)}).remove();
            const el=document.createElement('div');el.className=${JSON.stringify(gameDOM.attention.loading.slice(1))};
            el.style.cssText='width:20px;height:20px';document.body.append(el);
        }`);
        await changed;
        assert.deepEqual(attentionFlashes, [true, false, true], 'Unfocused non-minimized window must request native attention');
    }
    stopAttention();
    console.log(JSON.stringify({ electron: process.versions.electron, chromium: process.versions.chrome, preloadIPC: true,
        isolated: true, KI: !!extension, gameAttentionIPC: process.platform === 'win32', nativeFlashCall: attentionFlashes.includes(true),
        backgroundThrottling: false, backgroundProgress }));
    clearTimeout(timeout); window.destroy(); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); if (window && !window.isDestroyed()) window.destroy(); app.exit(1); });
