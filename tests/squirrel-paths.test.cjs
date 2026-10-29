const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');

function fixture(options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-squirrel-test-'));
    const project = path.join(root, options.ascii ? 'project' : 'Рабочий стол', 'client');
    const app = path.join(project, 'out', 'App-win32-x64'), makeDir = path.join(project, 'out', 'make');
    const icon = path.join(project, options.iconUnicode ? 'Иконки' : 'icons', 'setup.ico');
    fs.mkdirSync(app, { recursive: true }); fs.mkdirSync(path.dirname(icon), { recursive: true });
    fs.writeFileSync(path.join(app, 'app.exe'), 'application'); fs.writeFileSync(icon, 'icon');
    const calls = [], messages = [];
    class OriginalMaker {
        constructor(config) { this.config = config; }
        async make(value) {
            calls.push({ options: value, config: { ...this.config } });
            if (options.fail) throw Error('native resource editor failed');
            const dest = path.join(value.makeDir, 'squirrel.windows', value.targetArch);
            fs.mkdirSync(dest, { recursive: true });
            const outputs = ['RELEASES', 'installer.exe', 'full.nupkg'].map(name => {
                const file = path.join(dest, name); fs.writeFileSync(file, 'artifact ' + name); return file;
            });
            if (options.escape) outputs.push(icon);
            return outputs;
        }
    }
    const module = { exports: {} };
    const source = fs.readFileSync(path.join(__dirname, '../scripts/maker-squirrel.cjs'), 'utf8');
    vm.runInNewContext(source, { module, exports: module.exports, process: { env: options.env || {} },
        console: { info: message => messages.push(message), warn: message => messages.push(message) },
        require: name => name === '@electron-forge/maker-squirrel' ? { default: OriginalMaker }
            : name === 'node:os' ? { tmpdir: () => options.temp || root } : require(name) });
    const config = { setupIcon: icon, setupExe: 'installer.exe', iconUrl: 'https://example.com/icon.ico' };
    const maker = new module.exports(config);
    return { root, project, app, makeDir, icon, calls, messages, maker, config,
        args: { dir: app, makeDir, targetArch: 'x64', packageJSON: { version: '1.0.6' } },
        cleanup() {
            const resolved = path.resolve(root);
            assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
            assert.ok(path.basename(resolved).startsWith('ki-squirrel-test-'));
            fs.rmSync(resolved, { recursive: true, force: true });
        } };
}

test('Unicode Squirrel inputs stage through ASCII, restore config and return artifacts to normal output', async () => {
    const f = fixture();
    try {
        const files = await f.maker.make(f.args), call = f.calls[0];
        for (const value of [call.options.dir, call.options.makeDir, call.config.setupIcon]) assert.match(value, /^[\x20-\x7e]+$/);
        assert.equal(f.maker.config, f.config);
        assert.equal(call.config.setupExe, f.config.setupExe);
        assert.equal(call.config.iconUrl, f.config.iconUrl);
        assert.equal(fs.readFileSync(path.join(f.app, 'app.exe'), 'utf8'), 'application');
        assert.equal(fs.existsSync(path.dirname(call.options.dir)), false, 'Successful staging must be removed');
        for (const file of files) {
            assert.equal(path.dirname(file), path.join(f.makeDir, 'squirrel.windows', 'x64'));
            assert.equal(fs.readFileSync(file, 'utf8'), 'artifact ' + path.basename(file));
        }
    } finally { f.cleanup(); }
});

test('ASCII paths use original maker without staging', async () => {
    const f = fixture({ ascii: true });
    try {
        await f.maker.make(f.args);
        assert.equal(f.calls[0].options, f.args); assert.equal(f.messages.length, 0);
    } finally { f.cleanup(); }
});

test('Unicode setup icon alone triggers staging; ARM64 keeps a separate output directory', async () => {
    const f = fixture({ ascii: true, iconUnicode: true });
    try {
        f.args.targetArch = 'arm64'; const files = await f.maker.make(f.args);
        assert.notEqual(f.calls[0].options.dir, f.app);
        assert.ok(files.every(file => path.dirname(file) === path.join(f.makeDir, 'squirrel.windows', 'arm64')));
    } finally { f.cleanup(); }
});

test('native failure preserves existing output and diagnostic staging and restores configuration', async () => {
    const f = fixture({ fail: true });
    try {
        const old = path.join(f.makeDir, 'squirrel.windows', 'x64', 'installer.exe');
        fs.mkdirSync(path.dirname(old), { recursive: true }); fs.writeFileSync(old, 'previous installer');
        await assert.rejects(f.maker.make(f.args), /native resource editor failed/);
        assert.equal(f.maker.config, f.config);
        assert.equal(fs.readFileSync(old, 'utf8'), 'previous installer');
        assert.equal(fs.existsSync(f.calls[0].options.dir), true);
        assert.ok(f.messages.some(message => message.includes('diagnostic staging retained')));
    } finally { f.cleanup(); }
});

test('invalid staging paths and architecture fail before invoking native maker', async () => {
    for (const options of [{ temp: 'C:/Временные' }, { env: { KI_SQUIRREL_TEMP_DIR: './relative' } }]) {
        const f = fixture(options);
        try { await assert.rejects(f.maker.make(f.args), /ASCII|absolute/); assert.equal(f.calls.length, 0); }
        finally { f.cleanup(); }
    }
    const f = fixture();
    try { f.args.targetArch = '../outside'; await assert.rejects(f.maker.make(f.args), /architecture/); assert.equal(f.calls.length, 0); }
    finally { f.cleanup(); }
});

test('unexpected native artifact paths are rejected before overwriting final output', async () => {
    const f = fixture({ escape: true });
    try {
        await assert.rejects(f.maker.make(f.args), /Unexpected Squirrel artifact path/);
        assert.equal(fs.existsSync(path.join(f.makeDir, 'squirrel.windows', 'x64')), false);
    } finally { f.cleanup(); }
});

test('Forge default make/publish configuration selects the Unicode-safe maker', () => {
    const config = fs.readFileSync(path.join(__dirname, '../forge.config.ts'), 'utf8');
    assert.ok(config.includes('name: "./scripts/maker-squirrel.cjs"'));
    assert.ok(!config.includes('name: "@electron-forge/maker-squirrel"'));
});
