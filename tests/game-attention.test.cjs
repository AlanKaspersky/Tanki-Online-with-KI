const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const idle = { searching: false, loading: false, battle: false, results: false, disconnected: false };

function fixture(platform = 'win32') {
    const timers = new Map(), flashing = [], reports = [], scripts = [];
    let minimized = true, focused = false, destroyed = false, id = 0;
    const window = new EventEmitter(), ipc = new EventEmitter(), web = new EventEmitter();
    web.mainFrame = { url: 'https://tankionline.com/play/' };
    web.getURL = () => web.mainFrame.url;
    web.executeJavaScript = async code => { scripts.push(code); };
    Object.assign(window, { webContents: web, isMinimized: () => minimized,
        isFocused: () => focused,
        isDestroyed: () => destroyed, flashFrame: value => flashing.push(value) });
    const api = load('gameAttention', {}, {
        setTimeout: fn => { const key = ++id; timers.set(key, fn); return key; },
        clearTimeout: key => timers.delete(key),
    });
    const dispose = api.installGameAttention(window, ipc, message => reports.push(message), platform);
    return { ...api, window, ipc, web, scripts, flashing, reports, timers, dispose,
        minimized(value) { minimized = value; focused = !value; }, focused(value) { focused = value; },
        destroyed(value) { destroyed = value; },
        send(fields = {}, overrides = {}) {
            ipc.emit('ki:game-attention', { sender: web, senderFrame: web.mainFrame, ...overrides }, { ...idle, ...fields });
        },
        flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    };
}

test('minimized matchmaking flashes once until focused; restoring behind another window keeps attention', () => {
    const f = fixture(); f.send(); f.send({ searching: true }); f.send({ loading: true });
    assert.deepEqual(f.flashing, [true]);
    f.send({ battle: true }); f.send({ searching: true }); f.send({ loading: true });
    assert.deepEqual(f.flashing, [true]);
    f.minimized(false); f.focused(false); f.window.emit('restore');
    assert.deepEqual(f.flashing, [true]);
    f.focused(true); f.window.emit('focus'); assert.deepEqual(f.flashing, [true, false]);
    f.minimized(true);
    f.send({ searching: true }); f.send({ battle: true });
    assert.deepEqual(f.flashing, [true, false, true]);
    f.window.emit('focus'); assert.deepEqual(f.flashing, [true, false, true, false]);
});

test('unfocused non-minimized client alerts on queue-to-loader or HUD and clears when focused', () => {
    for (const destination of ['loading', 'battle']) {
        const f = fixture(); f.minimized(false); f.focused(false);
        f.send({ searching: true }); f.send({ [destination]: true });
        assert.deepEqual(f.flashing, [true]);
        f.send({ battle: true }); assert.deepEqual(f.flashing, [true]);
        f.focused(true); f.window.emit('focus'); assert.deepEqual(f.flashing, [true, false]);
        f.send({ searching: true }); f.send({ loading: true });
        assert.deepEqual(f.flashing, [true, false]);
    }
});

test('unfocused non-minimized client handles queue gaps, stopped search and focus during grace period', () => {
    for (const enterBattle of [false, true]) {
        const f = fixture(); f.minimized(false); f.focused(false);
        f.send({ searching: true }); f.send(); assert.equal(f.timers.size, 1);
        if (enterBattle) f.send({ loading: true });
        f.flush(); assert.deepEqual(f.flashing, [true]);
    }
    const f = fixture(); f.minimized(false); f.focused(false);
    f.send({ searching: true }); f.send(); f.focused(true); f.window.emit('focus');
    f.flush(); assert.deepEqual(f.flashing, []);
});

test('unfocused non-minimized connection errors and crashes alert, focused windows do not', () => {
    for (const focused of [false, true]) {
        for (const reason of ['disconnect', 'load-failure', 'crash']) {
            const f = fixture(); f.minimized(false); f.focused(focused);
            f.send({ battle: true });
            if (reason === 'disconnect') f.send({ disconnected: true });
            if (reason === 'load-failure') f.web.emit('did-fail-load', {}, -105, 'failed', f.web.mainFrame.url, true);
            if (reason === 'crash') f.web.emit('render-process-gone', {}, { reason: 'crashed' });
            assert.deepEqual(f.flashing, focused ? [] : [true], reason);
        }
    }
});

test('initial load, normal battle/results, garage loading and visible queue cancellation never flash', () => {
    const f = fixture(); f.send({ loading: true }); f.send({ battle: true }); f.send({ results: true });
    f.send(); f.send({ loading: true });
    assert.deepEqual(f.flashing, []);
    f.minimized(false); f.send({ searching: true }); f.send();
    f.minimized(true); f.flush(); f.send({ loading: true });
    assert.deepEqual(f.flashing, []);
    f.minimized(false); f.send({ searching: true }); f.send({ loading: true }); f.minimized(true);
    f.send({ battle: true }); assert.deepEqual(f.flashing, []);
});

test('queue-to-loader gap is tolerated; minimized stopped search alerts after the grace period', () => {
    const f = fixture(); f.send({ searching: true }); f.send();
    assert.equal(f.timers.size, 1); assert.deepEqual(f.flashing, []);
    f.send({ loading: true }); f.flush(); assert.deepEqual(f.flashing, [true]);
    assert.equal(f.timers.size, 0);
    const stopped = fixture(); stopped.send({ searching: true }); stopped.send(); stopped.flush();
    assert.deepEqual(stopped.flashing, [true]);
    assert.match(stopped.reports[0], /search ended/);
    const resumed = fixture(); resumed.send({ searching: true }); resumed.send(); resumed.send({ searching: true });
    resumed.flush(); assert.deepEqual(resumed.flashing, []);
    const restored = fixture(); restored.send({ searching: true }); restored.send(); restored.minimized(false);
    restored.window.emit('restore'); restored.flush(); assert.deepEqual(restored.flashing, []);
});

test('connection and kick dialogs notify only after game activity; repeating states do not restart attention', () => {
    const f = fixture(); f.send({ disconnected: true }); assert.deepEqual(f.flashing, []);
    f.send({ searching: true }); f.send({ disconnected: true }); f.send({ disconnected: true }); f.flush();
    assert.deepEqual(f.flashing, [true]);
    assert.equal(f.timers.size, 0);
    const battle = fixture(); battle.send({ battle: true }); battle.send({ disconnected: true });
    assert.deepEqual(battle.flashing, [true]);
});

test('main process rejects foreign senders, subframes, URLs and malformed values', () => {
    const f = fixture();
    for (const overrides of [{ sender: {} }, { senderFrame: {} }, { senderFrame: null }]) {
        f.send({ searching: true }, overrides);
    }
    for (const url of ['http://tankionline.com/play/', 'https://tankionline.com.evil.test/play/',
        'https://tankionline.com/player', 'https://example.com/play/']) {
        f.web.mainFrame.url = url; f.send({ searching: true });
    }
    f.web.mainFrame.url = 'https://tankionline.com/play/';
    const event = { sender: f.web, senderFrame: f.web.mainFrame };
    for (const value of [null, {}, [], { ...idle, searching: 'true' }, { ...idle, battle: 1 }]) {
        f.ipc.emit('ki:game-attention', event, value);
    }
    f.send({ loading: true }); assert.deepEqual(f.flashing, []);
    assert.equal(f.isGameAttentionURL('https://s.eu.tankionline.com/play/'), true);
});

test('main-frame load failure and renderer crash flash; aborts, subresources and clean exit do not', () => {
    const f = fixture();
    f.web.emit('did-fail-load', {}, -3, 'aborted', 'https://tankionline.com/play/', true);
    f.web.emit('did-fail-load', {}, -2, 'failed', 'https://tankionline.com/play/', false);
    f.web.emit('did-fail-load', {}, -2, 'failed', 'https://example.com/', true);
    f.web.emit('render-process-gone', {}, { reason: 'clean-exit' });
    assert.deepEqual(f.flashing, []);
    f.web.emit('did-fail-load', {}, -105, 'unreachable', 'https://tankionline.com/play/', true);
    assert.deepEqual(f.flashing, [true]);
    const crash = fixture(); crash.web.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.deepEqual(crash.flashing, [true]);
});

test('navigation and disposal cancel stale search state, timers, IPC and window handlers', () => {
    const f = fixture(); f.send({ searching: true }); f.send();
    f.web.emit('did-start-navigation', {}, 'https://tankionline.com/play/', false, true); f.flush();
    f.send({ loading: true }); assert.deepEqual(f.flashing, []);
    f.send({ searching: true }); f.send(); f.dispose(); f.dispose(); f.flush(); f.send({ battle: true });
    assert.equal(f.ipc.listenerCount('ki:game-attention'), 0);
    assert.equal(f.window.listenerCount('focus'), 0);
    assert.equal(f.web.listenerCount('dom-ready'), 0);
    assert.deepEqual(f.flashing, []);
    const closed = fixture(); closed.send({ searching: true }); closed.send({ loading: true });
    closed.destroyed(true); closed.window.emit('closed');
    assert.equal(closed.ipc.listenerCount('ki:game-attention'), 0);
});

test('DOM observer is injected only into the main trusted game document; errors are logged', async () => {
    const f = fixture(); f.web.emit('dom-ready'); await tick();
    assert.equal(f.scripts.length, 1); assert.match(f.scripts[0], /ki:game-attention/);
    f.web.mainFrame.url = 'https://example.com/'; f.web.emit('dom-ready'); assert.equal(f.scripts.length, 1);
    f.web.mainFrame.url = 'https://tankionline.com/play/';
    f.web.executeJavaScript = async () => { throw Error('navigated'); };
    f.web.emit('dom-ready'); await tick(); assert.match(f.reports[0], /Observer unavailable/);
    for (const platform of ['darwin', 'linux']) {
        const other = fixture(platform); other.web.emit('dom-ready');
        other.send({ searching: true }); other.send({ loading: true });
        assert.equal(other.ipc.listenerCount('ki:game-attention'), 0);
        assert.equal(other.scripts.length, 0); assert.deepEqual(other.flashing, []);
    }
});

function rendererFixture() {
    const { observeGameAttention } = load('gameAttention');
    const { gameDOM } = load('gameDOM');
    const elements = new Map(), timers = new Map(), events = new Map(), messages = [];
    let observer, callback, id = 0;
    const window = { location: { origin: 'https://tankionline.com' },
        postMessage(message, origin) { messages.push({ message, origin }); },
        setTimeout(fn) { const key = ++id; timers.set(key, fn); return key; }, clearTimeout: key => timers.delete(key),
        addEventListener(name, fn) { events.set(name, fn); } };
    class MutationObserver {
        constructor(fn) { callback = fn; observer = this; }
        observe(root, options) { this.root = root; this.options = options; }
        disconnect() { this.disconnected = true; }
    }
    const context = { window, MutationObserver, console, selectors: gameDOM.attention,
        document: { documentElement: {}, querySelectorAll: selector => elements.get(selector) || [] } };
    vm.runInNewContext('(' + observeGameAttention.toString() + ')(selectors)', context);
    return { messages, timers, events, observer,
        mutate() { callback([]); },
        set(key, text = '', visible = true, ariaHidden = false) {
            elements.set(gameDOM.attention[key], [{ textContent: text,
                getClientRects: () => visible ? [1] : [], closest: () => ariaHidden ? {} : null }]);
        },
        remove(key) { elements.delete(gameDOM.attention[key]); },
        flush() { const queued = [...timers.values()]; timers.clear(); queued.forEach(fn => fn()); },
        state: () => messages.at(-1).message.state,
    };
}

test('serialized observer is independent, coalesces mutations and reports changed visible markers', () => {
    const f = rendererFixture(); assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].origin, 'https://tankionline.com');
    f.set('searching'); for (let n = 0; n < 100; n++) f.mutate();
    assert.equal(f.timers.size, 1); f.flush(); assert.equal(f.state().searching, true);
    f.mutate(); f.flush(); assert.equal(f.messages.length, 2);
    f.remove('searching'); f.set('loading'); f.mutate(); f.flush(); assert.equal(f.state().loading, true);
    f.set('battle', '', false); f.set('results', '', true, true); f.mutate(); f.flush();
    assert.equal(f.state().battle, false); assert.equal(f.state().results, false);
    f.events.get('pagehide')(); f.mutate(); f.flush();
    assert.equal(f.observer.disconnected, true); assert.equal(f.timers.size, 0);
});

test('connection detector recognizes RU/EN dialog errors but ignores unrelated and hidden dialogs', () => {
    for (const text of ['Соединение с сервером потеряно', 'Потеряно соединение с сервером',
        'Вы были исключены из битвы', 'Ошибка подключения', 'Connection to the server has been lost',
        'You have been kicked from the battle', 'Server is restarting']) {
        const f = rendererFixture(); f.set('dialogs', text); f.mutate(); f.flush();
        assert.equal(f.state().disconnected, true, text);
    }
    const f = rendererFixture(); f.set('dialogs', 'Upgrade hull?'); f.mutate(); f.flush();
    assert.equal(f.state().disconnected, false);
    f.set('dialogs', 'Connection lost', false); f.mutate(); f.flush(); assert.equal(f.state().disconnected, false);
});

test('actual preload validates attention IPC and retains the Discord bridge without exposing Node', () => {
    let listener;
    const sent = [], window = { location: { protocol: 'https:', hostname: 'tankionline.com',
        pathname: '/play/', origin: 'https://tankionline.com' }, addEventListener(name, fn) { listener = fn; } };
    load('preload', { electron: { ipcRenderer: { send(...args) { sent.push(args); } } } }, { window });
    const event = { source: window, origin: window.location.origin,
        data: { type: 'ki:game-attention', version: 1, state: { ...idle, searching: true } } };
    for (const invalid of [{ ...event, source: {} }, { ...event, origin: 'https://example.com' },
        { ...event, data: { ...event.data, version: 2 } },
        { ...event, data: { ...event.data, state: { searching: true } } }]) listener(invalid);
    assert.equal(sent.length, 0);
    listener(event); assert.equal(sent[0][0], 'ki:game-attention'); assert.equal(sent[0][1].searching, true);
    listener({ ...event, data: { type: 'kasp:discord-presence', version: 1, presence: { details: 'Lobby', state: 'Test' } } });
    assert.equal(sent[1][0], 'ki:discord-presence');
    assert.equal(window.ipcRenderer, undefined);
    window.location.pathname = '/player'; listener(event); assert.equal(sent.length, 2);
});

test('main window wires attention before loading the game; preload uses no local require in its sandbox', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '../src/main.ts'), 'utf8');
    assert.ok(main.indexOf('installGameAttention(window, ipcMain') < main.indexOf('window.loadURL('));
    const preload = fs.readFileSync(path.resolve(__dirname, '../src/preload.ts'), 'utf8');
    assert.doesNotMatch(preload, /from\s+['"]\.\//);
});
