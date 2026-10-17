const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const MakerSquirrel = require('@electron-forge/maker-squirrel').default;
const ascii = value => /^[\x20-\x7e]+$/.test(value);

// The legacy Squirrel resource editor cannot open Unicode app/output/icon paths.
// Keep Forge's normal package/output locations; stage only the installer step.
module.exports = class UnicodeSafeSquirrel extends MakerSquirrel {
    async make(options) {
        const paths = [options.dir, options.makeDir, this.config.setupIcon].filter(Boolean).map(value => path.resolve(value));
        if (paths.every(ascii)) return super.make(options);
        if (!/^[a-z0-9_]+$/i.test(options.targetArch)) throw Error('Invalid Squirrel target architecture');
        const configured = process.env.KI_SQUIRREL_TEMP_DIR;
        if (configured && !path.isAbsolute(configured)) throw Error('KI_SQUIRREL_TEMP_DIR must be an absolute ASCII path');
        const base = path.resolve(configured || os.tmpdir());
        if (!ascii(base)) throw Error('Squirrel needs an ASCII temporary path. Set KI_SQUIRREL_TEMP_DIR to a writable Latin-character path.');
        fs.mkdirSync(base, { recursive: true });
        const work = fs.mkdtempSync(path.join(base, 'ki-squirrel-'));
        const saved = this.config;
        let completed = false;
        try {
            console.info('[KI build] Staging Squirrel installer in ' + work);
            const app = path.join(work, 'app'), makeDir = path.join(work, 'make');
            // Keep Node 22 on its JS copy implementation: its native fast path
            // can abort the entire process when copying Unicode Windows paths.
            fs.cpSync(options.dir, app, { recursive: true, filter: () => true });
            this.config = { ...saved };
            if (saved.setupIcon) {
                const icon = path.join(work, 'setup.ico');
                fs.copyFileSync(path.resolve(saved.setupIcon), icon);
                this.config.setupIcon = icon;
            }
            const artifacts = await super.make({ ...options, dir: app, makeDir });
            const expected = path.join(makeDir, 'squirrel.windows', options.targetArch);
            const destination = path.join(path.resolve(options.makeDir), 'squirrel.windows', options.targetArch);
            // Validate every returned artifact before touching the final output folder.
            for (const artifact of artifacts) {
                if (path.dirname(path.resolve(artifact)) !== expected || !fs.statSync(artifact).isFile()) {
                    throw Error('Unexpected Squirrel artifact path: ' + artifact);
                }
            }
            fs.mkdirSync(destination, { recursive: true });
            const finalArtifacts = artifacts.map(artifact => {
                const target = path.join(destination, path.basename(artifact));
                fs.copyFileSync(artifact, target);
                return target;
            });
            completed = true;
            return finalArtifacts;
        } finally {
            this.config = saved;
            if (completed) {
                // Delete only the exact temporary directory created by this invocation.
                const resolved = path.resolve(work);
                if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('ki-squirrel-')) {
                    throw Error('Refusing to clean an unexpected Squirrel staging path');
                }
                try { fs.rmSync(resolved, { recursive: true, force: true }); }
                catch (error) { console.warn('[KI build] Installer complete; staging cleanup failed: ' + String(error)); }
            } else console.warn('[KI build] Squirrel failed; diagnostic staging retained at ' + work);
        }
    }
};
