const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { verifyMacApp } = require('../scripts/verify-mac-app.cjs');
const load = require('./load.cjs');

test('Mac packaging uses strict ad-hoc signing without a Developer ID and fails on signing errors', () => {
    const config = load('../forge.config', {}, { process: { ...process, platform: 'darwin' } }).default;
    const signing = config.packagerConfig.osxSign;
    assert.equal(signing.identity, '-'); assert.equal(signing.identityValidation, false);
    assert.equal(signing.preAutoEntitlements, false); assert.equal(signing.continueOnError, false);
    assert.equal(signing.strictVerify, true);
    const file = signing.optionsForFile('/app');
    assert.equal(file.hardenedRuntime, true); assert.equal(file.timestamp, 'none');
    assert.ok(file.entitlements.includes('com.apple.security.cs.allow-jit'));
    assert.ok(file.entitlements.includes('com.apple.security.cs.disable-library-validation'));
    assert.equal(typeof config.hooks.postPackage, 'function');
});

test('Mac artifact checks reject missing seals, invalid signatures, wrong CPU and failed native startup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-mac-signing-'));
    const app = path.join(dir, 'Test.app'), seal = path.join(app, 'Contents', '_CodeSignature', 'CodeResources');
    let failure = '', calls = [];
    const run = async (command, args) => {
        calls.push({ command, args });
        if (command.endsWith('codesign')) { if (failure === 'signature') throw Error('invalid seal'); return { stdout: '' }; }
        if (command.endsWith('plutil')) return { stdout: JSON.stringify({ CFBundleExecutable: 'client', CFBundleShortVersionString: '1.0.5' }) };
        if (command.endsWith('lipo')) return { stdout: failure === 'cpu' ? 'x86_64' : 'arm64' };
        if (failure === 'startup') throw Error('startup killed');
        return { stdout: 'KI_STARTUP_CHECK_OK {}' };
    };
    try {
        await assert.rejects(verifyMacApp(app, 'arm64', '1.0.5', { run, hostArch: 'arm64' }));
        assert.equal(calls.length, 0);
        fs.mkdirSync(path.dirname(seal), { recursive: true }); fs.writeFileSync(seal, 'seal');
        for (const mode of ['signature', 'cpu', 'startup']) {
            failure = mode; await assert.rejects(verifyMacApp(app, 'arm64', '1.0.5', { run, hostArch: 'arm64' }));
        }
        failure = ''; calls = [];
        const result = await verifyMacApp(app, 'arm64', '1.0.5', { run, hostArch: 'arm64' });
        assert.equal(result.signature, 'verified'); assert.ok(result.startup.includes('KI_STARTUP_CHECK_OK'));
        assert.deepEqual(calls[0].args.slice(0, 4), ['--verify', '--deep', '--strict', '--verbose=2']);
        assert.equal(calls.at(-1).args[0], '--ki-startup-check');
        assert.equal(calls.at(-1).command, path.join(app, 'Contents', 'MacOS', 'client'));
    } finally {
        assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('ki-mac-signing-')); fs.rmSync(dir, { recursive: true, force: true });
    }
});
