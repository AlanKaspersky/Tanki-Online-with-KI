const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const load = require('./load.cjs');
test('Forge produces an unambiguous ZIP/checksum pair for each Mac architecture', async () => {
    const config = load('../forge.config').default;
    const maker = config.makers.find(maker => maker.name === '@electron-forge/maker-zip');
    assert.ok(maker); assert.deepEqual(Array.from(maker.platforms), ['darwin']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-artifact-test-'));
    try {
        const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
        const results = ['x64', 'arm64'].map(arch => {
            const file = path.join(dir, arch + '.zip'); fs.writeFileSync(file, 'test archive ' + arch);
            return { platform: 'darwin', arch, artifacts: [file] };
        });
        const output = await config.hooks.postMake(config, results);
        for (const result of output) {
            const expected = `to-${version}-darwin-${result.arch}.zip`;
            assert.equal(result.artifacts.length, 2); assert.equal(path.basename(result.artifacts[0]), expected);
            const sum = fs.readFileSync(result.artifacts[1], 'utf8');
            const hash = createHash('sha256').update(fs.readFileSync(result.artifacts[0])).digest('hex');
            assert.equal(sum, `${hash}  ${expected}\n`);
        }
    } finally {
        assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('ki-artifact-test-')); fs.rmSync(dir, { recursive: true, force: true });
    }
});
test('client and lockfile versions match and the stable Electron pin is installed', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')), lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    assert.equal(pkg.version, lock.version); assert.equal(pkg.version, lock.packages[''].version);
    assert.equal(pkg.devDependencies.electron, '44.8.0');
    assert.equal(lock.packages['node_modules/electron'].version, pkg.devDependencies.electron);
    assert.equal(require('electron/package.json').version, pkg.devDependencies.electron);
});
