const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const load = require('./load.cjs');
const zip = require('./zip-fixture.cjs');
function fixture(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-prepare-test-'));
    const target = path.join(dir, 'Installed.app'), executable = path.join(target, 'Contents', 'MacOS', 'client');
    const info = { CFBundleIdentifier: 'com.ki.client', CFBundleExecutable: 'client', CFBundleShortVersionString: '1.0.4' };
    const nextInfo = { ...info, CFBundleShortVersionString: '1.0.5', ...(options.badIdentity ? { CFBundleIdentifier: 'other' } : {}) };
    const binary = Buffer.alloc(512); binary.writeUInt32LE(0xfeedfacf); binary.writeUInt32LE(0x0100000c, 4);
    fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.writeFileSync(executable, 'original client');
    fs.writeFileSync(path.join(target, 'Contents', 'Info.plist'), JSON.stringify(info));
    const entries = [{ name: 'Tanki Online with KI.app/Contents/Info.plist', data: JSON.stringify(nextInfo) },
        { name: 'Tanki Online with KI.app/Contents/MacOS/client', data: binary, mode: 0x81ed }];
    const archive = options.badZip ? zip([{ name: '../bad', data: 'no' }]) : zip(entries);
    const name = 'to-1.0.5-darwin-arm64.zip';
    const digest = options.badChecksum ? '0'.repeat(64) : createHash('sha256').update(archive).digest('hex');
    const sum = Buffer.from(`${digest}  ${name}\n`);
    const release = { version: '1.0.5', zip: { name, size: archive.length, url: 'https://github.com/' + name },
        checksum: { name: name + '.sha256', size: sum.length, url: 'https://github.com/' + name + '.sha256' } };
    const state = path.join(dir, 'userdata', 'pending.json'); let extractions = 0;
    const api = load('macUpdates', {
        'node:fs': { ...fs, realpathSync: file => fs.realpathSync(file).replaceAll('\\', '/'),
            promises: { ...fs.promises, access: async (file, mode) => {
                if (options.readOnly && mode === fs.constants.W_OK) throw Error('permission denied');
                return fs.promises.access(file, mode);
            } } },
        'node:child_process': { execFile(command, args, opts, callback) {
            try {
                if (command.endsWith('/plutil')) { callback(null, { stdout: fs.readFileSync(args.at(-1), 'utf8') }); return; }
                assert.equal(command, '/usr/bin/ditto'); extractions++;
                for (const entry of entries) {
                    const destination = path.join(args.at(-1), entry.name);
                    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, entry.data, { mode: 0o755 });
                }
                callback(null, { stdout: '' });
            } catch (error) { callback(error); }
        } },
    }, { fetch: async url => {
        const bytes = url.endsWith('.sha256') ? sum : archive;
        return { ok: true, url: 'https://release-assets.githubusercontent.com/file', body: (async function* () {
            yield bytes.subarray(0, 4); yield bytes.subarray(4);
        })() };
    } });
    return { api, release, state, executable, dir, target, extractions: () => extractions,
        original: () => fs.readFileSync(executable, 'utf8'),
        clean() { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('ki-prepare-test-')); fs.rmSync(dir, { recursive: true, force: true }); } };
}
test('Mac preparation verifies downloads/archive/bundle, persists resumable state and never replaces the running client', async () => {
    const f = fixture(); try {
        const result = await f.api.prepareMacUpdate(f.release, f.executable, 'arm64', f.state);
        assert.equal(f.extractions(), 1); assert.equal(f.original(), 'original client');
        assert.equal(JSON.parse(fs.readFileSync(f.state, 'utf8')).version, '1.0.5');
        const restored = await f.api.readPreparedMacUpdate(f.state, f.executable, '1.0.4', 'arm64');
        assert.equal(restored.candidate, result.candidate);
        assert.equal(await f.api.readPreparedMacUpdate(f.state, f.executable, '1.0.5', 'arm64'), null);
    } finally { f.clean(); }
});
for (const failure of ['badChecksum', 'badZip', 'badIdentity', 'readOnly']) {
    test(`failed Mac preparation (${failure}) leaves installation untouched and does not persist an install request`, async () => {
        const f = fixture({ [failure]: true }); try {
            await assert.rejects(f.api.prepareMacUpdate(f.release, f.executable, 'arm64', f.state));
            assert.equal(f.original(), 'original client'); assert.equal(fs.existsSync(f.state), false);
            assert.equal(fs.readdirSync(f.dir).some(name => name.startsWith('.tanki-ki-update-')), false, 'failed attempts release their own staging files');
            if (failure !== 'badIdentity') assert.equal(f.extractions(), 0);
        } finally { f.clean(); }
    });
}
