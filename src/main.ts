import OS from "os";
import FS from "fs";
import Path from "path";
import { spawn } from "child_process";
import parseArgs from "minimist";
import { BrowserWindow, app as application, dialog, session, shell, ipcMain } from "electron";
import log from "electron-log/main";
import { createHash } from "crypto";
import { XMLParser } from "fast-xml-parser";
import { Downloader as FileDownloader } from "nodejs-file-downloader";
import extractZip from "extract-zip";
import { Entry as ZipEntry } from "yauzl";

import { DiscordPresence, validPresence, copyPresence } from "./discordPresence";
import { startClientUpdates } from "./clientUpdates";
import { runStartupCheck } from "./startupCheck";
import { installGameAttention } from "./gameAttention";
import { gameWebPreferences } from "./gameWindow";
import { installKiGameGate } from "./kiGameGate";

const TANKI_ONLINE_URL = "https://tankionline.com/play/";

const EXTERNAL_BROWSER_URLS = [
    "https://github.com/AlanKaspersky/Kaspersky-Inventions-for-Tanki-Online"
];
const KASPERSKY_EXTENSION_KEY =
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApkHGubYDs+KYsU4zd2XJ" +
    "TpQ2ve+NeyVSXhemfedNhgxF/ObN1ax1+nCTBK0Nhp9hdwVOgHY8MP7Kgpniq8hH" +
    "Xte6u623y/YO8+SLfWdNz/rX/H2ZDcid5YWfOsAVMJ3v0wDoHpJi64usDi9JpZdR" +
    "hjm1bJaTBCZQvbKIRu3Qn+JPkVjFASyzo86tKLodus0rCIXSKa6kulY+CBR+7mMM" +
    "hxdGTIPdKXwkZXoqUtRkakPIwvhXfzMWtpdoZols/jlWz3jPKaDINNene86fYQ6h" +
    "LUIOnajPb/ButR6j8P/B76GZ5c9LdnN50d86hKhyiu25u4wDedfdq4XMxAq2VJRU" +
    "qwIDAQAB";

const options = parseArgs(process.argv.slice(1));

async function main() {

    Object.assign(console, log.functions);

    if (require("electron-squirrel-startup")) {
        application.quit(); return;
    }
    if (OS.platform() === "win32" &&
        process.env.GPU_SET !== "true") {
        spawn(process.execPath, process.argv.slice(1), {
            detached: true,
            stdio: "ignore",
            env: {
                ...process.env,
                SHIM_MCCOMPAT: "0x800000001",
                GPU_SET: "true"
            }
        }).unref();
        application.quit(); return;
    }

    application.commandLine.appendSwitch("disable-renderer-backgrounding");
    application.commandLine.appendSwitch("force_high_performance_gpu");
    application.commandLine.appendSwitch("ignore-gpu-blocklist");
    application.commandLine.appendSwitch("enable-gpu-rasterization");
    await application.whenReady();
    if (options["ki-startup-check"]) { await runStartupCheck(); return; }

    if (!(await canConnect(options.url ?? TANKI_ONLINE_URL))) {
        dialog.showErrorBox("Error / Ошибка",
            "Unable to connect to the game server.\n\n" +
            "Нет подключения к серверу игры.");
        application.quit(); return;
    }

    // Explicit local-development mode overrides Chrome Web Store KI only.
    // An unpacked local extension is never updated by the store updater.
    const localKiPath = String(options["ki-extension-path"] ||
        process.env.KI_EXTENSION_PATH || "").trim();
    try {
        await updateAndLoadExtensions(application.getPath("userData"), localKiPath);
    } catch (error) {
        log.error(error);
        dialog.showErrorBox("KI extension / Расширение KI", String(error));
        application.quit(); return;
    }
    createMainWindow();
}

async function canConnect(url: string,
    tries: number = 3): Promise<boolean> {

    for (let i = 0; i < tries; i++) {
        try {
            await fetch(url,
                { signal: AbortSignal.timeout(5000) });
            return true;
        } catch (error) { }
    }
    return false;
}

function createMainWindow() {

    const window = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "Tanki Online with KI",
        titleBarStyle: OS.platform() === "darwin" ?
            "customButtonsOnHover" : "default",
        webPreferences: gameWebPreferences(Path.join(__dirname, "preload.js")),
        show: false
    });
    if (OS.platform() === "win32")
        window.setIcon(Path.join(application.getAppPath(),
            "resources/icons/icon.ico"));
    if (OS.platform() === "linux")
        window.setIcon(Path.join(application.getAppPath(),
            "resources/icons/icon.png"));
    window.setMenuBarVisibility(false);
    installGameAttention(window, ipcMain, message => log.info(message));
    // The extension supplies game state; this process only transports it to Discord.
    let discordApplicationId = String(options["discord-application-id"] || process.env.KI_DISCORD_APPLICATION_ID || "");
    if (!discordApplicationId) {
        try {
            const config = JSON.parse(FS.readFileSync(Path.join(application.getAppPath(), "discord-presence.json"), "utf8"));
            discordApplicationId = String(config.applicationId || "");
        } catch { }
    }
    if (!/^\d{17,20}$/.test(discordApplicationId)) log.info("[KI Discord] Set applicationId in discord-presence.json to enable Rich Presence.");
    const discord = new DiscordPresence(discordApplicationId, message => log.warn(message));
    let lastPresenceAt = 0;
    const receivePresence = (event: Electron.IpcMainEvent, value: unknown) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
        try {
            const url = new URL(event.senderFrame.url);
            if (url.protocol !== "https:" || !/(^|\.)tankionline\.com$/.test(url.hostname) || !(url.pathname === "/play" || url.pathname.startsWith("/play/"))) return;
        } catch { return; }
        if (value === null) {
            lastPresenceAt = 0;
            discord.update(null);
            return;
        }
        if (!validPresence(value)) return;
        lastPresenceAt = Date.now();
        discord.update(copyPresence(value));
    };
    ipcMain.on("ki:discord-presence", receivePresence);
    // Background renderer timers may be throttled; keep the last activity alive.
    const resumePresence = () => { if (lastPresenceAt) lastPresenceAt = Date.now(); };
    window.on("restore", resumePresence);
    window.on("show", resumePresence);
    const presenceLease = setInterval(() => {
        if (window.isMinimized() || !window.isVisible()) { resumePresence(); return; }
        if (lastPresenceAt && Date.now() - lastPresenceAt > 30000) {
            lastPresenceAt = 0;
            discord.update(null);
        }
    }, 5000);
    window.webContents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => {
        if (mainFrame) { lastPresenceAt = 0; discord.update(null); }
    });
    window.webContents.on("render-process-gone", () => {
        lastPresenceAt = 0;
        discord.update(null);
    });
    window.once("closed", () => {
        clearInterval(presenceLease);
        window.removeListener("restore", resumePresence);
        window.removeListener("show", resumePresence);
        ipcMain.removeListener("ki:discord-presence", receivePresence);
        discord.dispose();
    });

    window.webContents.setWindowOpenHandler(
        ({ url }) => {
            if (EXTERNAL_BROWSER_URLS.includes(url)) {
                shell.openExternal(url);
                return { action: "deny" };
            }
            return { action: "allow" };
        });
    window.once("ready-to-show", () => {
        window.maximize();
        startClientUpdates(window);
    });
    window.loadURL(options.url ?? TANKI_ONLINE_URL);
}

function selectExtensions(
    extensions: Array<{ path: string; manifest: any }>,
    extensionsPath: string,
    key: string,
    occupiedPaths: string[]
) {
    const isKI = (extension: { manifest: any }) => extension.manifest.key === key ||
        extension.manifest.name === "Tanki Online: Kaspersky's Inventions";
    const pathKey = (value: string) => Path.resolve(value).toLowerCase();
    const canonical = Path.join(extensionsPath, "kaspersky-inventions");
    const storeCopies = extensions.filter(extension => extension.manifest.key === key);
    let preferredKI = storeCopies.find(extension => pathKey(extension.path) === pathKey(canonical)) || storeCopies[0];
    if (!preferredKI) {
        // Never overwrite an unpacked copy or an unrelated/invalid directory.
        const occupied = new Set([...occupiedPaths, ...extensions.map(extension => extension.path)].map(pathKey));
        let target = canonical, suffix = 1;
        while (occupied.has(pathKey(target))) {
            target = Path.join(extensionsPath, "kaspersky-inventions-store" + (suffix === 1 ? "" : "-" + suffix));
            suffix++;
        }
        preferredKI = { path: target, manifest: { key } };
    }
    const skipped = extensions.filter(extension => isKI(extension) && extension !== preferredKI);
    const selected = extensions.filter(extension => !isKI(extension) || extension === preferredKI);
    if (!selected.includes(preferredKI)) selected.push(preferredKI);
    return { selected, skipped, preferredKI };
}

async function updateAndLoadExtensions(userDataPath: string, localKiPath = "") {

    const extensionsPath = Path.join(userDataPath, "extensions");
    if (!FS.existsSync(extensionsPath)) FS.mkdirSync(extensionsPath);

    const extensions = new Array<{ path: string; manifest: any }>();
    const directoryPaths =
        FS.readdirSync(extensionsPath, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith(".ki-extension-update-"))
            .map((dirent) => Path.join(extensionsPath, dirent.name));
            
    for (const directoryPath of directoryPaths) {
        try {
            const manifestPath = Path.join(directoryPath, "manifest.json");
            if (!FS.existsSync(manifestPath)) continue;
            const manifest = JSON.parse(FS.readFileSync(manifestPath,
                { encoding: "utf-8" }));
            extensions.push({ path: directoryPath, manifest });
        } catch (error) {
            log.error(error);
        }
    }

    // Without an explicit override, preserve the existing official-store policy.
    // In development mode the named unpacked folder always takes priority,
    // irrespective of its manifest version, path, or Chrome Web Store copy.
    const usingLocalKi = Boolean(localKiPath.trim());
    let selection = selectExtensions(
        extensions, extensionsPath, KASPERSKY_EXTENSION_KEY, directoryPaths);
    if (usingLocalKi) {
        const localPath = Path.resolve(localKiPath.trim());
        const manifestPath = Path.join(localPath, "manifest.json");
        if (!FS.existsSync(manifestPath)) {
            throw new Error(`[KI] Local extension manifest not found: ${manifestPath}`);
        }
        let manifest: any;
        try {
            manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
        } catch (error) {
            throw new Error(`[KI] Invalid local extension manifest: ${manifestPath}: ${String(error)}`);
        }
        if (manifest.key !== KASPERSKY_EXTENSION_KEY &&
            manifest.name !== "Tanki Online: Kaspersky's Inventions") {
            throw new Error(`[KI] The local folder does not contain a KI extension: ${localPath}`);
        }
        for (const file of ["dist/kasp_injector.js", "dist/kasp_main.js", "dist/kasp_game_gate.js"]) {
            if (!FS.existsSync(Path.join(localPath, file))) {
                throw new Error(`[KI] Local KI is missing ${file}. Run npm run build:js in the extension project.`);
            }
        }
        const localKI = { path: localPath, manifest };
        const otherExtensions = extensions.filter(extension =>
            extension.manifest.key !== KASPERSKY_EXTENSION_KEY &&
            extension.manifest.name !== "Tanki Online: Kaspersky's Inventions");
        selection = {
            selected: [...otherExtensions, localKI],
            skipped: extensions.filter(extension => !otherExtensions.includes(extension)),
            preferredKI: localKI
        };
    }
    const { selected, skipped, preferredKI } = selection;
    log.info(usingLocalKi
        ? `[KI] Using local development extension (auto-update disabled): ${preferredKI.path}`
        : `[KI] Using Chrome Web Store extension: ${preferredKI.path}`);
    for (const duplicate of skipped) {
        log.info(`[KI] Skipping local/duplicate extension: ${duplicate.path}; using ${preferredKI.path}`);
    }

    let gameGateInstalled = false;
    for (const extension of selected) {
        if (!usingLocalKi || extension !== preferredKI) {
            try {
                await updateExtension(extension);
            } catch (error) {
                // A failed update check must not prevent loading an installed store copy.
                log.error(error);
            }
        }
        try {
            const loaded = await session.defaultSession.extensions.loadExtension(extension.path);
            if (extension === preferredKI) {
                // Only the official selected KI copy may own the network gate.
                // Register before createMainWindow() begins game navigation.
                const gateFile = Path.join(extension.path, "dist", "kasp_game_gate.js");
                if (FS.existsSync(gateFile)) {
                    const gateURL = installKiGameGate(session.defaultSession, loaded.id,
                        (url, type) => log.info(`[KI Game Gate] Redirect requested ${type}: ${url}`));
                    gameGateInstalled = true;
                    log.info(`[KI Game Gate] Enabled: ${gateURL}`);
                } else {
                    log.warn(`[KI Game Gate] Missing packaged gate: ${gateFile}`);
                    if (usingLocalKi) throw new Error(`Missing local KI game gate: ${gateFile}`);
                }
            }
        } catch (error) {
            log.error(error);
            if (usingLocalKi && extension === preferredKI) {
                throw new Error(`[KI] Failed to load local extension from ${preferredKI.path}: ${String(error)}`);
            }
        }
    }
    if (!gameGateInstalled) {
        log.warn("[KI Game Gate] Not active: KI extension or dist/kasp_game_gate.js not loaded");
        if (usingLocalKi) throw new Error("[KI] Local extension loaded without the required game gate");
    }
}

async function updateExtension(extension: { path: string; manifest: any }) {

    const manifest = extension.manifest;
    if (manifest.key == null) return;
    const extensionID = extensionKeyToID(manifest.key);
    const latestVersion = await getLatestExtensionVersion(extensionID,
        manifest.update_url);
    if (manifest.version === latestVersion.version) return;

    const crxPath = Path.join(application.getPath("temp"),
        extensionID + ".crx");
    const zipPath = Path.join(application.getPath("temp"),
        extensionID + ".zip");
    const stagingPath = FS.mkdtempSync(Path.join(Path.dirname(extension.path), ".ki-extension-update-"));
    const previousPath = stagingPath + "-previous";
    let installed = false;
    try {
        await new FileDownloader({
            url: latestVersion.crx,
            directory: Path.dirname(crxPath),
            fileName: Path.basename(crxPath),
            cloneFiles: false
        }).download();
        FS.writeFileSync(zipPath, unwrapCRX(FS.readFileSync(crxPath)));
        await extractZip(zipPath, {
            dir: stagingPath,
            onEntry: fixZipEntryPermissions
        });
        // A packed store CRX can omit `key` from manifest.json. Retain the
        // registered identity so the next launch can update this unpacked copy.
        const installedManifestPath = Path.join(stagingPath, "manifest.json");
        const installedManifest = JSON.parse(FS.readFileSync(installedManifestPath, "utf8"));
        if (installedManifest.version !== latestVersion.version ||
            installedManifest.key != null && installedManifest.key !== manifest.key) {
            throw new Error("Downloaded extension identity/version mismatch");
        }
        installedManifest.key = manifest.key;
        if (!installedManifest.update_url && manifest.update_url) installedManifest.update_url = manifest.update_url;
        FS.writeFileSync(installedManifestPath, JSON.stringify(installedManifest, null, 2) + "\n");
        const hadPrevious = FS.existsSync(extension.path);
        if (hadPrevious) FS.renameSync(extension.path, previousPath);
        try {
            FS.renameSync(stagingPath, extension.path);
        } catch (error) {
            // If restoring fails, the previous directory stays available for recovery.
            if (hadPrevious) FS.renameSync(previousPath, extension.path);
            throw error;
        }
        installed = true;
        extension.manifest = installedManifest;
    } finally {
        FS.rmSync(stagingPath, { recursive: true, force: true });
        if (installed) FS.rmSync(previousPath, { recursive: true, force: true });
        FS.rmSync(crxPath, { force: true });
        FS.rmSync(zipPath, { force: true });
    }
}

function fixZipEntryPermissions(entry: ZipEntry) {

    if (entry.externalFileAttributes === 0) return;
    const mode = (entry.externalFileAttributes >> 16) & 0xFFFF;

    let isDirectory = (mode & 61440) === 16384;
    if (!isDirectory && entry.fileName.endsWith("/"))
        isDirectory = true;
    if (!isDirectory) isDirectory =
        (entry.versionMadeBy >> 8) === 0 &&
        entry.externalFileAttributes === 16;

    const attributes = (mode & ~0o777) |
        (isDirectory ? 0o755 : 0o644);
    entry.externalFileAttributes &= ~(0xFFFF << 16);
    entry.externalFileAttributes |= attributes << 16;
}

function extensionKeyToID(key: string): string {

    const keyDER = Buffer.from(key, "base64");
    const keyHash = createHash("sha256").update(keyDER)
        .digest("hex").substring(0, 32);
    let id = "";
    for (const char of keyHash)
        id += String.fromCharCode("a".charCodeAt(0) +
            parseInt(char, 16));
    return id;
}

async function getLatestExtensionVersion(
    id: string, updateURL: string =
        "https://clients2.google.com/service/update2/crx"
): Promise<{ version: string; crx: string }> {

    const os =
        OS.platform() === "win32" ? "win" :
            OS.platform() === "darwin" ? "mac" : "linux";
    const arch =
        OS.arch() === "ia32" ? "x86-32" :
            OS.arch() === "x64" ? "x86-64" :
                OS.arch().startsWith("arm") ? "arm" : "x86-64";

    const queryParams = {
        response: "updatecheck",
        os, arch, nacl_arch: arch,
        prod: "chromiumcrx",
        prodchannel: "unknown",
        prodversion: process.versions.chrome ?? "9999.0.9999.0",
        acceptformat: "crx2,crx3",
        x: `id=${id}&uc`
    };
    const queryString = "?" + new URLSearchParams(queryParams).toString();
    const updateResponse = await fetch(new URL(queryString, updateURL));

    const responseXML =
        new XMLParser({ ignoreAttributes: false })
            .parse(await updateResponse.text());
    const updatecheckTag = responseXML.gupdate?.app?.updatecheck;
    if (!(updatecheckTag != null &&
        "@_version" in updatecheckTag &&
        "@_codebase" in updatecheckTag))
        throw new Error("invalid update response");
    return {
        version: updatecheckTag["@_version"],
        crx: updatecheckTag["@_codebase"]
    };
}

function unwrapCRX(buffer: Buffer): Buffer {

    function readCRXVersion(buffer: Buffer):
        "crx-2" | "crx-3" | null {
        const version = buffer.readUInt32LE(4);
        if (version === 2) return "crx-2";
        if (version === 3) return "crx-3";
        return null;
    }

    if (buffer.readUInt32BE(0) === 0x50_4B_03_04)
        return Buffer.from(buffer);
    if (buffer.readUInt32BE(0) !== 0x43_72_32_34)
        throw new Error("invalid CRX header");
    const version = readCRXVersion(buffer);
    if (version === null)
        throw new Error("unknown CRX version");
    const offset = version === "crx-2" ?
        16 + buffer.readUInt32LE(8) + buffer.readUInt32LE(12) :
        12 + buffer.readUInt32LE(8);
    return Buffer.from(buffer.subarray(offset));
}

main();
