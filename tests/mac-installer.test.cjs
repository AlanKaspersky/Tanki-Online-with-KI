const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../resources/mac-update.sh'), 'utf8');
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
const available = fs.existsSync(shell);
function run(mode) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ki-installer-test-'));
    const target = path.join(dir, "Tanki's $(false) & KI.app"), stage = path.join(dir, '.tanki-ki-update-test');
    const candidate = path.join(stage, 'unpacked', 'Tanki Online with KI.app');
    fs.mkdirSync(path.join(target, 'Contents'), { recursive: true }); fs.writeFileSync(path.join(target, 'Contents', 'version'), 'old');
    fs.mkdirSync(path.join(candidate, 'Contents'), { recursive: true }); fs.writeFileSync(path.join(candidate, 'Contents', 'version'), 'new');
    // Only OS command results are substituted. The real helper's sequencing/quoting/moves run in a POSIX shell.
    const prelude = `ki_test_open() { ${mode === 'open-failure' ? 'return 1' : 'return 0'}; }\n`
        + `ki_test_kill() { ${mode === 'still-running' ? 'return 0' : 'return 1'}; }\nki_test_sleep() { :; }\n`
        + `ki_test_mv() { ${mode === 'move-failure' ? 'if [ "$1" = "$candidate" ]; then return 1; fi;' : ''} /bin/mv "$@"; }\n`;
    const script = path.join(dir, 'run.sh');
    fs.writeFileSync(script, prelude + source.replaceAll('/usr/bin/open', 'ki_test_open').replaceAll('/bin/kill', 'ki_test_kill')
        .replaceAll('/bin/sleep', 'ki_test_sleep').replaceAll('/bin/mv', 'ki_test_mv'));
    const result = spawnSync(shell, [script, '99999999', target, candidate, stage], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return { dir, target, stage, result, version: () => fs.readFileSync(path.join(target, 'Contents', 'version'), 'utf8'),
        clean() { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('ki-installer-test-')); fs.rmSync(dir, { recursive: true, force: true }); } };
}
test('macOS installation script is valid POSIX shell', { skip: !available }, () => {
    const result = spawnSync(shell, ['-n', path.join(__dirname, '../resources/mac-update.sh')], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
});
test('installer handles spaces and shell metacharacters, preserving the previous application', { skip: !available }, () => {
    const f = run('success'); try {
        assert.equal(f.result.status, 0, f.result.stderr + JSON.stringify(f.result.error)); assert.equal(f.version(), 'new');
        assert.equal(fs.readFileSync(path.join(f.stage, 'previous.app', 'Contents', 'version'), 'utf8'), 'old');
    } finally { f.clean(); }
});
for (const mode of ['move-failure', 'open-failure', 'still-running']) {
    test(`installer preserves/restores the original app when ${mode}`, { skip: !available }, () => {
        const f = run(mode); try {
            assert.equal(f.result.error, undefined);
            assert.ok(fs.existsSync(path.join(f.stage, 'installer-started')), f.result.stderr);
            assert.notEqual(f.result.status, 0); assert.equal(f.version(), 'old');
        } finally { f.clean(); }
    });
}
