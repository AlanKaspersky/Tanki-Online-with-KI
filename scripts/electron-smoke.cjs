const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
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
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, '../build/preload.js'), contextIsolation: true, nodeIntegration: false } });
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
    console.log(JSON.stringify({ electron: process.versions.electron, chromium: process.versions.chrome, preloadIPC: true, isolated: true, KI: !!extension }));
    clearTimeout(timeout); window.destroy(); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); if (window && !window.isDestroyed()) window.destroy(); app.exit(1); });
