import OS from "os";
import FS from "fs";
import Path from "path";
import { spawn } from "child_process";
import parseArgs from "minimist";
import { BrowserWindow, app as application, dialog, session, shell, ipcMain } from "electron";
import log from "electron-log/main";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { createHash } from "crypto";
import { XMLParser } from "fast-xml-parser";
import { Downloader as FileDownloader } from "nodejs-file-downloader";
import extractZip from "extract-zip";
import { Entry as ZipEntry } from "yauzl";

import { DiscordPresence, validPresence, copyPresence } from "./discordPresence";

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

    if (OS.platform() === "win32") {
        updateElectronApp({
            logger: log,
            updateSource: {
                type: UpdateSourceType.ElectronPublicUpdateService,
                host: "https://update.electronjs.org",
                repo: "AlanKaspersky/Kaspersky-Inventions-for-Tanki-Online"
            },
            updateInterval: "1 hour",
            notifyUser: false
        });
    }

    application.commandLine.appendSwitch("disable-renderer-backgrounding");
    application.commandLine.appendSwitch("force_high_performance_gpu");
    application.commandLine.appendSwitch("ignore-gpu-blocklist");
    application.commandLine.appendSwitch("enable-gpu-rasterization");
    await application.whenReady();

    if (!(await canConnect(options.url ?? TANKI_ONLINE_URL))) {
        dialog.showErrorBox("Error / Ошибка",
            "Unable to connect to the game server.\n\n" +
            "Нет подключения к серверу игры.");
        application.quit(); return;
    }

    await updateAndLoadExtensions(application.getPath("userData"));
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
        webPreferences: { preload: Path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
        show: false
    });
    if (OS.platform() === "win32")
        window.setIcon(Path.join(application.getAppPath(),
            "resources/icons/icon.ico"));
    if (OS.platform() === "linux")
        window.setIcon(Path.join(application.getAppPath(),
            "resources/icons/icon.png"));
    window.setMenuBarVisibility(false);
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
    const presenceLease = setInterval(() => {
        if (lastPresenceAt && Date.now() - lastPresenceAt > 30000) {
            lastPresenceAt = 0;
            discord.update(null);
        }
    }, 5000);
    window.webContents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => {
        if (mainFrame) { lastPresenceAt = 0; discord.update(null); }
    });
    window.once("closed", () => {
        clearInterval(presenceLease);
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
    window.once("ready-to-show", () =>
        window.maximize());
    window.loadURL(options.url ?? TANKI_ONLINE_URL);
}

async function updateAndLoadExtensions(userDataPath: string) {

    const extensionsPath = Path.join(userDataPath, "extensions");
    if (!FS.existsSync(extensionsPath)) FS.mkdirSync(extensionsPath);

    const extensions = new Array<{ path: string; manifest: any }>();
    const directoryPaths =
        FS.readdirSync(extensionsPath, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory())
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

    const isKI = (extension: { manifest: any }) =>
        extension.manifest.key === KASPERSKY_EXTENSION_KEY ||
        extension.manifest.name === "Tanki Online: Kaspersky's Inventions";
    const kiCandidates = extensions.filter(isKI);
    // A manually installed development copy takes precedence over the store copy.
    const preferredKI = kiCandidates.find(extension => !extension.manifest.key) || kiCandidates[0];
    if (!preferredKI) {
        const kiExtension = {
            path: Path.join(extensionsPath, "kaspersky-inventions"),
            manifest: {
                key: KASPERSKY_EXTENSION_KEY
            }
        };
        extensions.push(kiExtension);
    }

    for (const extension of extensions) {
        if (preferredKI && isKI(extension) && extension !== preferredKI) {
            log.info(`[KI] Skipping duplicate extension: ${extension.path}; using ${preferredKI.path}`);
            continue;
        }
        try {
            await updateExtension(extension);
            await session.defaultSession
                .loadExtension(extension.path);
        } catch (error) {
            log.error(error);
        }
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
    try {
        await new FileDownloader({
            url: latestVersion.crx,
            directory: Path.dirname(crxPath),
            fileName: Path.basename(crxPath),
            cloneFiles: false
        }).download();
        FS.writeFileSync(zipPath, unwrapCRX(FS.readFileSync(crxPath)));
        FS.rmSync(extension.path, { recursive: true, force: true });
        await extractZip(zipPath, {
            dir: extension.path,
            onEntry: fixZipEntryPermissions
        });
    } finally {
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
