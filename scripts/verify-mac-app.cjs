const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

async function verifyMacApp(app, arch, version, dependencies = {}) {
    const run = dependencies.run || promisify(execFile);
    const hostArch = dependencies.hostArch || process.arch;
    if (!['arm64', 'x64'].includes(arch)) throw Error('Unsupported Mac architecture');
    if (!path.isAbsolute(app) || !app.endsWith('.app')) throw Error('Invalid application path');
    await fs.promises.access(path.join(app, 'Contents', '_CodeSignature', 'CodeResources'));
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { timeout: 30000 });
    const plist = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents', 'Info.plist')], { timeout: 10000 });
    const info = JSON.parse(plist.stdout);
    if (info.CFBundleShortVersionString !== version || typeof info.CFBundleExecutable !== 'string' ||
        !info.CFBundleExecutable || /[\\/]/.test(info.CFBundleExecutable)) throw Error('Incorrect packaged Mac identity/version');
    const binary = path.join(app, 'Contents', 'MacOS', info.CFBundleExecutable);
    const cpu = await run('/usr/bin/lipo', ['-archs', binary], { timeout: 10000 });
    if (cpu.stdout.trim() !== (arch === 'arm64' ? 'arm64' : 'x86_64')) throw Error('Packaged Mac binary has the wrong architecture');
    let startup = 'cross-architecture: signature checked, startup not run';
    if (arch === hostArch) {
        const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
        const result = await run(binary, ['--ki-startup-check'], { timeout: 30000, maxBuffer: 1024 * 1024, env });
        if (!result.stdout.includes('KI_STARTUP_CHECK_OK ')) throw Error('Packaged Mac startup probe did not complete');
        startup = result.stdout.trim();
    }
    return { arch, signature: 'verified', startup };
}
module.exports = { verifyMacApp };
if (require.main === module) {
    if (process.platform !== 'darwin') { console.error('Mac artifact verification requires macOS'); process.exitCode = 1; }
    else verifyMacApp(...process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
        console.error(error.message); process.exitCode = 1;
    });
}
