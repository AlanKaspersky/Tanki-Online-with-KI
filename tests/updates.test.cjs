const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}, expose = '') {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', file + '.ts'), 'utf8');
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code + expose, { module, exports: module.exports, Buffer, URL, process, console, setTimeout, clearTimeout, setInterval, clearInterval, ...globals,
        require: name => name in mocks ? mocks[name] : name.startsWith('./') ? load(name.slice(2), mocks, globals) : require(name) });
    return module.exports;
}
const policy = load('releasePolicy');
const base = `https://github.com/${policy.CLIENT_REPOSITORY}`;
function release(tag = '1.0.5', arch = 'arm64') {
    const name = `to-${tag.replace(/^v/, '')}-darwin-${arch}.zip`;
    return { tag_name: tag, html_url: `${base}/releases/tag/${tag}`, draft: false, prerelease: false,
        assets: [name, name + '.sha256'].map(name => ({ name, size: name.endsWith('.sha256') ? 100 : 100000,
            browser_download_url: `${base}/releases/download/${tag}/${name}` })) };
}
test('only newer stable numeric versions are offered, including v-prefixed tags', () => {
    assert.ok(policy.newerVersion('v1.10.0', '1.9.9'));
    for (const version of ['1.0.4', '1.0.3', '1.0.5-beta.1', 'latest', '01.1.0']) assert.equal(policy.newerVersion(version, '1.0.4'), false);
    assert.equal(policy.readClientRelease(release('v1.0.5'), '1.0.4', 'arm64').version, '1.0.5');
    for (const field of ['draft', 'prerelease']) assert.equal(policy.readClientRelease({ ...release(), [field]: true }, '1.0.4', 'arm64'), null);
});
test('Mac update assets must match the architecture, exact repository and complete checksum pair', () => {
    const data = release();
    assert.ok(policy.readClientRelease(data, '1.0.4', 'arm64').zip);
    assert.equal(policy.readClientRelease(data, '1.0.4', 'x64').zip, undefined);
    assert.equal(policy.readClientRelease({ ...data, html_url: 'https://evil.example' }, '1.0.4', 'arm64'), null);
    data.assets[0].browser_download_url = 'https://evil.example/client.zip';
    assert.equal(policy.readClientRelease(data, '1.0.4', 'arm64').zip, undefined);
    const missing = release(); missing.assets.pop();
    assert.equal(policy.readClientRelease(missing, '1.0.4', 'arm64').checksum, undefined);
    const huge = release(); huge.assets[0].size = 2 ** 40;
    assert.equal(policy.readClientRelease(huge, '1.0.4', 'arm64').zip, undefined);
});
test('checksum files bind SHA-256 to the exact ZIP name', () => {
    const hash = 'a'.repeat(64), name = 'to-1.0.5-darwin-arm64.zip';
    assert.equal(policy.readChecksum(`${hash}  ${name}\n`, name), hash);
    for (const text of [`${hash}  other.zip`, 'bad', `${hash}  ${name}\nextra`]) assert.throws(() => policy.readChecksum(text, name));
});
test('archive entry paths cannot escape or introduce control characters and Windows separators', () => {
    const app = 'Tanki Online with KI.app';
    assert.ok(policy.safeArchiveEntry(app + '/Contents/MacOS/tanki-online-with-ki', app));
    for (const name of ['../../x', app + '/../x', '/tmp/x', app + '/Contents\\x', app + '/x\ny', app + '//x', 'Other.app/Contents/x']) {
        assert.equal(policy.safeArchiveEntry(name, app), false, name);
    }
});
test('prepared updates cannot choose arbitrary application or staging paths', () => {
    const posix = require('node:path').posix;
    const mac = load('macUpdates', { 'node:path': posix });
    const target = '/Applications/Tanki Online with KI.app';
    const value = { target, stage: '/Applications/.tanki-ki-update-abc', candidate: '/Applications/.tanki-ki-update-abc/unpacked/Tanki Online with KI.app', version: '1.0.5' };
    assert.ok(mac.validPreparedUpdate(value, target, '1.0.4'));
    assert.equal(mac.validPreparedUpdate({ ...value, target: '/Applications/Other.app' }, target, '1.0.4'), false);
    assert.equal(mac.validPreparedUpdate({ ...value, candidate: '/tmp/Other.app' }, target, '1.0.4'), false);
    assert.equal(mac.validPreparedUpdate(value, target, '1.0.5'), false);
    assert.throws(() => mac.appBundlePath('/Volumes/Installer/Tanki Online with KI.app/Contents/MacOS/tanki-online-with-ki'));
    assert.equal(mac.appBundlePath('/Applications/Tanki Online with KI.app/Contents/MacOS/tanki-online-with-ki'), target);
});
test('the installer waits for client exit, quotes path arguments, retains rollback copy and never changes quarantine policy', () => {
    const source = fs.readFileSync(path.join(__dirname, '../resources/mac-update.sh'), 'utf8');
    assert.ok(source.indexOf('while /bin/kill -0') < source.indexOf('/bin/mv "$target" "$backup"'));
    assert.ok(source.includes('/bin/mv "$backup" "$target"'));
    assert.doesNotMatch(source, /rm\s+-rf|xattr|spctl|sudo|eval/);
});


test('GitHub canonical and lowercase repository URLs are accepted without weakening tag/asset checks', () => {
    const data = release();
    const canonical = 'https://github.com/AlanKaspersky/Tanki-Online-with-KI';
    data.html_url = canonical + '/releases/tag/1.0.5';
    for (const asset of data.assets) asset.browser_download_url = canonical + '/releases/download/1.0.5/' + asset.name;
    assert.ok(policy.readClientRelease(data, '1.0.4', 'arm64')?.zip);
    const lower = JSON.parse(JSON.stringify(data).replaceAll('AlanKaspersky/Tanki-Online-with-KI', 'alankaspersky/tanki-online-with-ki'));
    assert.ok(policy.readClientRelease(lower, '1.0.4', 'arm64')?.zip);
    for (const suffix of ['?other=1', '#other', '/extra']) assert.equal(policy.readClientRelease({ ...data, html_url: data.html_url + suffix }, '1.0.4', 'arm64'), null);
    for (const bad of ['https://github.com/Other/Tanki-Online-with-KI/releases/tag/1.0.5', 'https://user@github.com/AlanKaspersky/Tanki-Online-with-KI/releases/tag/1.0.5']) assert.equal(policy.readClientRelease({ ...data, html_url: bad }, '1.0.4', 'arm64'), null);
    const wrongAsset = structuredClone(data); wrongAsset.assets[0].browser_download_url = wrongAsset.assets[0].browser_download_url.replace('.zip', '.ZIP');
    assert.equal(policy.readClientRelease(wrongAsset, '1.0.4', 'arm64').zip, undefined);
});
