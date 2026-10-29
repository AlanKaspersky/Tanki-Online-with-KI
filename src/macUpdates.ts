import FS from "node:fs";
import Path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { open as openZip, Entry } from "yauzl";
import { ClientRelease, ReleaseAsset, newerVersion, readChecksum, safeArchiveEntry } from "./releasePolicy";

const run = promisify(execFile);
const APP_NAME = "Tanki Online with KI.app";
const STAGE_PREFIX = ".tanki-ki-update-";
export interface PreparedMacUpdate { stage: string; target: string; candidate: string; version: string; }

export function appBundlePath(executable: string): string {
    const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(executable);
    if (!match) throw new Error("The application is not running from an installed macOS bundle");
    const app = Path.resolve(match[1]);
    if (app.startsWith("/Volumes/") || app.includes("/AppTranslocation/")) throw new Error("Install the client in Applications before updating");
    return app;
}
export function validPreparedUpdate(value: unknown, target: string, installed: string): value is PreparedMacUpdate {
    if (!value || typeof value !== "object") return false;
    const data = value as PreparedMacUpdate;
    return typeof data.version === "string" && newerVersion(data.version, installed) && data.target === target
        && typeof data.stage === "string" && Path.dirname(data.stage) === Path.dirname(target)
        && Path.basename(data.stage).startsWith(STAGE_PREFIX) && data.stage === Path.resolve(data.stage)
        && data.candidate === Path.join(data.stage, "unpacked", APP_NAME);
}
async function plist(app: string): Promise<Record<string, unknown>> {
    const result = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", Path.join(app, "Contents/Info.plist")], { timeout: 10000, maxBuffer: 1024 * 1024 });
    return JSON.parse(result.stdout);
}
export async function validateMacBundle(candidate: string, target: string, version: string, arch: string): Promise<void> {
    const [next, current] = await Promise.all([plist(candidate), plist(target)]);
    if (typeof current.CFBundleIdentifier !== "string" || next.CFBundleIdentifier !== current.CFBundleIdentifier
        || next.CFBundleExecutable !== current.CFBundleExecutable || typeof next.CFBundleExecutable !== "string"
        || /[\/\\]/.test(next.CFBundleExecutable) || next.CFBundleShortVersionString !== version) throw new Error("The update bundle identity/version does not match this client");
    const executable = Path.join(candidate, "Contents/MacOS", next.CFBundleExecutable);
    await FS.promises.access(executable, FS.constants.X_OK);
    const handle = await FS.promises.open(executable, "r");
    try {
        const bytes = Buffer.alloc(512); await handle.read(bytes, 0, bytes.length, 0);
        const cpu = arch === "arm64" ? 0x0100000c : arch === "x64" ? 0x01000007 : 0;
        let matches = bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === cpu;
        if (bytes.readUInt32BE(0) === 0xcafebabe && bytes.readUInt32BE(4) <= 20) {
            for (let i = 0; i < bytes.readUInt32BE(4); i++) if (bytes.readUInt32BE(8 + i * 20) === cpu) matches = true;
        }
        if (!cpu || !matches) throw new Error("The update executable has the wrong CPU architecture");
    } finally { await handle.close(); }
}

async function inspectArchive(filename: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        openZip(filename, { lazyEntries: true }, (error, archive) => {
            if (error || !archive) { reject(error || Error("Invalid ZIP")); return; }
            let count = 0, total = 0, nameBytes = 0, finished = false;
            const names = new Set<string>(), links = new Set<string>();
            const fail = (error: unknown) => { if (!finished) { finished = true; archive.close(); reject(error); } };
            archive.on("error", fail);
            archive.on("end", () => {
                if (finished) return;
                for (const name of names) for (let slash = name.indexOf("/"); slash >= 0; slash = name.indexOf("/", slash + 1)) {
                    if (links.has(name.slice(0, slash))) { fail(Error("ZIP writes through a symbolic link")); return; }
                }
                finished = true; resolve();
            });
            archive.on("entry", (entry: Entry) => {
                const name = entry.fileName;
                const canonical = name.replace(/\/$/, "").normalize("NFC").toLowerCase();
                total += entry.uncompressedSize;
                nameBytes += name.length;
                if (++count > 50000 || total > 2 * 1024 ** 3 || nameBytes > 16 * 1024 ** 2 || !safeArchiveEntry(name, APP_NAME) || names.has(canonical)) { fail(Error("Unsafe or oversized update ZIP")); return; }
                names.add(canonical);
                const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
                if (kind && ![0x8000, 0x4000, 0xa000].includes(kind)) { fail(Error("Unsupported ZIP entry type")); return; }
                if (kind !== 0xa000) { archive.readEntry(); return; }
                links.add(canonical);
                if (entry.uncompressedSize > 4096) { fail(Error("Oversized ZIP symbolic link")); return; }
                archive.openReadStream(entry, (error, stream) => {
                    if (error || !stream) { fail(error || Error("Invalid ZIP symbolic link")); return; }
                    const chunks: Buffer[] = []; let size = 0;
                    stream.on("error", fail);
                    stream.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 4096) { stream.destroy(); fail(Error("Oversized ZIP link")); } else chunks.push(chunk); });
                    stream.on("end", () => {
                        if (finished) return;
                        const target = Buffer.concat(chunks).toString("utf8");
                        const resolved = Path.posix.normalize(Path.posix.join(Path.posix.dirname(name), target));
                        if (!target || Path.posix.isAbsolute(target) || /[\\\x00-\x1f]/.test(target) || !resolved.startsWith(APP_NAME + "/")) { fail(Error("ZIP link escapes the application")); return; }
                        archive.readEntry();
                    });
                });
            });
            archive.readEntry();
        });
    });
}

async function download(asset: ReleaseAsset, destination: string): Promise<string> {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(10 * 60 * 1000), headers: { "User-Agent": "Tanki-Online-with-KI-Updater" } });
    if (!response.ok || !response.body) throw new Error(`Update download failed: HTTP ${response.status}`);
    const final = new URL(response.url);
    if (final.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com"].includes(final.hostname)) throw new Error("Unexpected update download host");
    const file = await FS.promises.open(destination, "wx", 0o600), hash = createHash("sha256"); let size = 0;
    try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            size += chunk.length;
            if (size > asset.size) throw new Error("Update download exceeds its declared size");
            hash.update(chunk); await file.writeFile(chunk);
        }
        if (size !== asset.size) throw new Error("Incomplete update download");
        return hash.digest("hex");
    } finally { await file.close(); }
}

export async function prepareMacUpdate(release: ClientRelease, executable: string, arch: string, stateFile: string): Promise<PreparedMacUpdate> {
    if (!release.zip || !release.checksum) throw new Error("The release is missing its macOS ZIP or SHA-256 file");
    const target = appBundlePath(FS.realpathSync(executable));
    await FS.promises.access(Path.dirname(target), FS.constants.W_OK);
    const stage = await FS.promises.mkdtemp(Path.join(Path.dirname(target), STAGE_PREFIX));
    await FS.promises.chmod(stage, 0o700);
    try {
    const archive = Path.join(stage, "update.zip"), sum = Path.join(stage, "update.sha256");
    await download(release.checksum, sum);
    const expected = readChecksum(await FS.promises.readFile(sum, "utf8"), release.zip.name);
    const actual = await download(release.zip, archive);
    if (actual !== expected) throw new Error("Update SHA-256 verification failed");
    await inspectArchive(archive);
    const unpacked = Path.join(stage, "unpacked"); await FS.promises.mkdir(unpacked);
    await run("/usr/bin/ditto", ["-x", "-k", archive, unpacked], { timeout: 180000, maxBuffer: 1024 * 1024 });
    const candidate = Path.join(unpacked, APP_NAME);
    await validateMacBundle(candidate, target, release.version, arch);
    const prepared: PreparedMacUpdate = { stage, target, candidate, version: release.version };
    await FS.promises.mkdir(Path.dirname(stateFile), { recursive: true });
    await FS.promises.writeFile(stateFile + ".tmp", JSON.stringify(prepared), { mode: 0o600 });
    await FS.promises.rename(stateFile + ".tmp", stateFile);
    await FS.promises.unlink(archive).catch(() => {});
    return prepared;
    } catch (error) {
        // Only remove the staging directory created by this attempt, never an installed bundle.
        if (Path.dirname(Path.resolve(stage)) === Path.dirname(Path.resolve(target)) && Path.basename(stage).startsWith(STAGE_PREFIX)) {
            await FS.promises.rm(stage, { recursive: true, force: true }).catch(() => {});
        }
        await FS.promises.unlink(stateFile + ".tmp").catch(() => {});
        throw error;
    }
}
export async function readPreparedMacUpdate(stateFile: string, executable: string, installed: string, arch: string): Promise<PreparedMacUpdate | null> {
    try {
        const raw = await FS.promises.readFile(stateFile, "utf8"); if (raw.length > 16000) return null;
        const value: unknown = JSON.parse(raw), target = appBundlePath(FS.realpathSync(executable));
        if (!validPreparedUpdate(value, target, installed)) return null;
        await validateMacBundle(value.candidate, target, value.version, arch);
        return value;
    } catch { return null; }
}
export async function launchMacInstaller(prepared: PreparedMacUpdate, helperSource: string): Promise<void> {
    const stage = FS.realpathSync(prepared.stage), parent = FS.realpathSync(Path.dirname(prepared.target));
    if (Path.dirname(stage) !== parent || !Path.basename(stage).startsWith(STAGE_PREFIX)
        || prepared.candidate !== Path.join(prepared.stage, "unpacked", APP_NAME)) throw new Error("Invalid update installation paths");
    const helper = Path.join(stage, "install.sh"), ack = Path.join(stage, "installer-started");
    await FS.promises.unlink(ack).catch(error => { if (error.code !== "ENOENT") throw error; });
    await FS.promises.copyFile(helperSource, helper); await FS.promises.chmod(helper, 0o700);
    const child = spawn("/bin/sh", [helper, String(process.pid), prepared.target, prepared.candidate, stage], { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    for (let i = 0; i < 30; i++) {
        if (FS.existsSync(ack)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("The update installer did not start");
}
