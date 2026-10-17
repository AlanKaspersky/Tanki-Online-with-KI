const { spawnSync } = require('node:child_process');
const path = require('node:path');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [path.join(__dirname, 'electron-smoke.cjs')], {
    stdio: 'inherit', env: environment, windowsHide: true, timeout: 45000,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
