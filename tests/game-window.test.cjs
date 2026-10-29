const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load.cjs');

test('background game execution keeps the restricted preload and renderer isolation', () => {
    const { gameWebPreferences } = load('gameWindow');
    const prefs = gameWebPreferences('/app/build/preload.js');
    assert.equal(prefs.preload, '/app/build/preload.js');
    assert.equal(prefs.backgroundThrottling, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false);
    prefs.backgroundThrottling = true;
    assert.equal(gameWebPreferences('/other/preload.js').backgroundThrottling, false);
});

test('game window, packaged startup probe and Electron smoke use the same background preferences', () => {
    for (const file of ['src/main.ts', 'src/startupCheck.ts', 'scripts/electron-smoke.cjs']) {
        const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
        assert.match(source, /webPreferences:\s*gameWebPreferences\(/, file);
    }
    const smoke = fs.readFileSync(path.resolve(__dirname, '../scripts/electron-smoke.cjs'), 'utf8');
    assert.match(smoke, /window\.isMinimized\(\), true/);
    assert.match(smoke, /backgroundProgress\.frames > 0/);
    assert.match(smoke, /backgroundProgress\.ticks > 0/);
});
