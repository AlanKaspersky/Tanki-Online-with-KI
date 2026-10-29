const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const load = require('./load.cjs');
const zip = require('./zip-fixture.cjs');
const app = 'Tanki Online with KI.app';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ki-update-test-'));
const clean = directory => {
    const resolved = path.resolve(directory), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('ki-update-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
};
const expose = '\nmodule.exports.testing = { inspectArchive, download };';
const mac = load('macUpdates', {}, {}, expose);
test('real ZIP parser accepts bundled files and internal framework links', async () => {
    const dir = temp();
    try {
        const file = path.join(dir, 'valid.zip');
        fs.writeFileSync(file, zip([{ name: app + '/Contents/Frameworks/Test.framework/Versions/A/resource', data: 'x' },
            { name: app + '/Contents/Frameworks/Test.framework/Versions/Current', data: 'A', mode: 0xa1ff }]));
        await mac.testing.inspectArchive(file);
    } finally { clean(dir); }
});
test('real ZIP parser rejects traversal, escaping symlinks, symlink writes, duplicate case-folded names and special files', async () => {
    const cases = [
        [{ name: '../outside', data: 'bad' }],
        [{ name: app + '/Contents/link', data: '/etc', mode: 0xa1ff }],
        [{ name: app + '/Contents/link', data: '../../../outside', mode: 0xa1ff }],
        [{ name: app + '/Contents/link', data: 'file', mode: 0xa1ff }, { name: app + '/Contents/link/child', data: 'bad' }],
        [{ name: app + '/Contents/File', data: 'a' }, { name: app + '/Contents/file', data: 'b' }],
        [{ name: app + '/Contents/pipe', data: '', mode: 0x11a4 }],
        [{ name: app + '/Contents/link', data: 'a'.repeat(4097), mode: 0xa1ff }],
    ];
    const dir = temp();
    try {
        for (let i = 0; i < cases.length; i++) {
            const file = path.join(dir, i + '.zip'); fs.writeFileSync(file, zip(cases[i]));
            await assert.rejects(mac.testing.inspectArchive(file));
        }
        const invalid = path.join(dir, 'broken.zip'); fs.writeFileSync(invalid, 'not-a-zip');
        await assert.rejects(mac.testing.inspectArchive(invalid));
    } finally { clean(dir); }
});
test('streamed downloads verify declared size and calculate the full SHA-256', async () => {
    const dir = temp(), data = Buffer.from('verified client update');
    const source = load('macUpdates', {}, { fetch: async () => ({ ok: true, url: 'https://release-assets.githubusercontent.com/file',
        body: (async function* () { yield data.subarray(0, 3); yield data.subarray(3); })() }) }, expose);
    try {
        const file = path.join(dir, 'update.zip');
        const digest = await source.testing.download({ url: 'https://github.com/release', size: data.length }, file);
        assert.equal(digest, createHash('sha256').update(data).digest('hex'));
        assert.deepEqual(fs.readFileSync(file), data);
        await assert.rejects(source.testing.download({ url: 'https://github.com/release', size: data.length }, file), /EEXIST/);
    } finally { clean(dir); }
});
test('failed HTTP, truncated/oversized streams and unexpected redirect hosts cannot be accepted as an update', async () => {
    const dir = temp();
    try {
        const cases = [
            { ok: false, status: 404 },
            { ok: true, url: 'https://evil.example/file', body: (async function* () { yield Buffer.from('x'); })() },
            { ok: true, url: 'https://github.com/file', body: (async function* () { yield Buffer.from('x'); })() },
            { ok: true, url: 'https://github.com/file', body: (async function* () { yield Buffer.alloc(100); })() },
            { ok: true, url: 'https://github.com/file', body: (async function* () { throw Error('connection lost'); })() },
        ];
        for (let i = 0; i < cases.length; i++) {
            const source = load('macUpdates', {}, { fetch: async () => cases[i] }, expose);
            await assert.rejects(source.testing.download({ url: 'https://github.com/release', size: 10 }, path.join(dir, i + '.zip')));
        }
    } finally { clean(dir); }
});
test('bundle validation checks identity, version, executable name and Mach-O CPU type', async () => {
    const dir = temp(), executable = path.join(dir, 'Contents', 'MacOS', 'client');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    const info = { CFBundleIdentifier: 'com.ki.client', CFBundleExecutable: 'client', CFBundleShortVersionString: '1.0.5' };
    let candidateInfo = info;
    const source = load('macUpdates', { 'node:child_process': { execFile(command, args, opts, callback) {
        const value = args.at(-1).includes('installed') ? { ...info, CFBundleShortVersionString: '1.0.4' } : candidateInfo;
        callback(null, { stdout: JSON.stringify(value), stderr: '' });
    } } });
    try {
        const bytes = Buffer.alloc(512); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x0100000c, 4); fs.writeFileSync(executable, bytes, { mode: 0o755 });
        await source.validateMacBundle(dir, 'installed', '1.0.5', 'arm64');
        await assert.rejects(source.validateMacBundle(dir, 'installed', '1.0.5', 'x64'), /architecture/);
        for (const change of [{ CFBundleIdentifier: 'other' }, { CFBundleExecutable: '../bad' }, { CFBundleShortVersionString: '0.0.1' }]) {
            candidateInfo = { ...info, ...change };
            await assert.rejects(source.validateMacBundle(dir, 'installed', '1.0.5', 'arm64'), /identity/);
        }
    } finally { clean(dir); }
});
