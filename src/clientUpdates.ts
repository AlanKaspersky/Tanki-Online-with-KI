import FS from "node:fs";
import Path from "node:path";
import { app, autoUpdater, BrowserWindow, dialog, shell } from "electron";
import log from "electron-log/main";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { CLIENT_REPOSITORY, ClientRelease, RELEASE_API, readClientRelease } from "./releasePolicy";
import { launchMacInstaller, prepareMacUpdate, PreparedMacUpdate, readPreparedMacUpdate } from "./macUpdates";

export function startClientUpdates(window: BrowserWindow): () => void {
    if (!app.isPackaged) return () => {};
    const ru = app.getLocale().toLowerCase().startsWith("ru");
    const stateFile = Path.join(app.getPath("userData"), "updates", "pending-mac.json");
    const notified = new Set<string>();
    let stopped = false, checking = false, prompting = false, nativeReady = false;
    let ready: PreparedMacUpdate | null = null;
    let pending: ClientRelease | null = null;
    const visible = () => !stopped && !window.isDestroyed() && window.isVisible() && !window.isMinimized();
    const warn = (error: unknown) => log.warn("[KI Update]", error);
    const promptNativeReady = async () => {
        if (!nativeReady || !visible() || prompting || notified.has("native-ready")) return;
        prompting = true; notified.add("native-ready");
        try {
            const answer = await dialog.showMessageBox(window, { type: "info", title: ru ? "Обновление клиента" : "Client update",
                message: ru ? "Новая версия клиента загружена" : "A client update has been downloaded",
                detail: ru ? "Перезапустить клиент и установить обновление? Текущая игровая сессия будет закрыта." : "Restart to install the update? Your current game session will close.",
                buttons: ru ? ["Обновить и перезапустить", "Позже"] : ["Update and restart", "Later"], defaultId: 1, cancelId: 1 });
            if (answer.response === 0 && !stopped) autoUpdater.quitAndInstall();
        } catch (error) { warn(error); }
        finally { prompting = false; }
    };
    const promptReady = async () => {
        if (!ready || !visible() || prompting || notified.has("ready:" + ready.version)) return;
        prompting = true; notified.add("ready:" + ready.version);
        try {
            const answer = await dialog.showMessageBox(window, { type: "info", title: ru ? "Обновление клиента" : "Client update",
                message: ru ? `Версия ${ready.version} готова к установке` : `Version ${ready.version} is ready to install`,
                detail: ru ? "Перезапустить клиент и установить обновление? Текущая игровая сессия будет закрыта." : "Restart the client to install the update? Your current game session will close.",
                buttons: ru ? ["Обновить и перезапустить", "Позже"] : ["Update and restart", "Later"], defaultId: 1, cancelId: 1 });
            if (answer.response === 0 && !stopped) {
                await launchMacInstaller(ready, Path.join(app.getAppPath(), "resources/mac-update.sh"));
                app.quit();
            }
        } catch (error) { warn(error); }
        finally { prompting = false; }
    };
    const promptRelease = async () => {
        if (!pending || !visible() || prompting || notified.has(pending.version)) return;
        const release = pending; prompting = true; notified.add(release.version);
        try {
            const automatic = process.platform === "darwin" && !!release.zip && !!release.checksum;
            const answer = await dialog.showMessageBox(window, { type: "info", title: ru ? "Доступно обновление" : "Update available",
                message: ru ? `Tanki Online with KI ${release.version}` : `Tanki Online with KI ${release.version}`,
                detail: ru ? `Установлена версия ${app.getVersion()}. ${automatic ? "Скачать обновление в фоне? Перезапуск потребуется только после отдельного подтверждения." : "Открыть релиз на GitHub для установки новой версии?"}`
                    : `Installed version: ${app.getVersion()}. ${automatic ? "Download the update in the background? Restarting will require a separate confirmation." : "Open the GitHub release to install the new version?"}`,
                buttons: ru ? [automatic ? "Скачать обновление" : "Открыть релиз", "Позже"] : [automatic ? "Download update" : "Open release", "Later"], defaultId: 1, cancelId: 1 });
            if (answer.response !== 0 || stopped) return;
            if (!automatic) { await shell.openExternal(release.page); return; }
            window.setProgressBar(2);
            try { ready = await prepareMacUpdate(release, process.execPath, process.arch, stateFile); }
            catch (error) {
                warn(error);
                if (!visible()) return;
                const fallback = await dialog.showMessageBox(window, { type: "warning", title: ru ? "Не удалось установить обновление" : "Unable to prepare update",
                    message: ru ? "Текущая установка клиента сохранена." : "Your current client installation is unchanged.",
                    detail: ru ? "Проверьте подключение и доступ на запись к папке приложения. Если клиент запущен с DMG, сначала перенесите его в Applications. Можно установить обновление вручную с GitHub."
                        : "Check your connection and write access to the application folder. If running from a DMG, move the client to Applications first. You can install the GitHub release manually.",
                    buttons: ru ? ["Открыть релиз", "Закрыть"] : ["Open release", "Close"], defaultId: 1, cancelId: 1 });
                if (fallback.response === 0 && !stopped) await shell.openExternal(release.page);
            } finally { if (!window.isDestroyed()) window.setProgressBar(-1); }
        } catch (error) { warn(error); }
        finally { prompting = false; }
        if (ready) await promptReady();
    };
    const checkGitHub = async () => {
        if (checking || stopped) return;
        checking = true;
        try {
            if (process.platform === "darwin" && !ready) ready = await readPreparedMacUpdate(stateFile, process.execPath, app.getVersion(), process.arch);
            if (ready) { await promptReady(); return; }
            const response = await fetch(RELEASE_API, { signal: AbortSignal.timeout(15000), headers: {
                Accept: "application/vnd.github+json", "User-Agent": "Tanki-Online-with-KI-Updater", "X-GitHub-Api-Version": "2022-11-28" } });
            if (!response.ok || !response.body) throw new Error(`GitHub update check: HTTP ${response.status}`);
            const chunks: Buffer[] = []; let bytes = 0;
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
                bytes += chunk.length; if (bytes > 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error("Oversized GitHub response"); }
                chunks.push(Buffer.from(chunk));
            }
            pending = readClientRelease(JSON.parse(Buffer.concat(chunks).toString("utf8")), app.getVersion(), process.arch);
            await promptRelease();
        } catch (error) { warn(error); }
        finally { checking = false; }
    };
    const squirrel = process.platform === "win32" && FS.existsSync(Path.resolve(Path.dirname(process.execPath), "..", "Update.exe"));
    const onNativeError = () => { void checkGitHub(); };
    if (squirrel) {
        autoUpdater.on("error", onNativeError);
        try {
            updateElectronApp({ logger: log, updateSource: { type: UpdateSourceType.ElectronPublicUpdateService,
                host: "https://update.electronjs.org", repo: CLIENT_REPOSITORY }, updateInterval: "1 hour", notifyUser: true,
                onNotifyUser(info) {
                    nativeReady = true;
                    void promptNativeReady();
                } });
        } catch (error) { warn(error); void checkGitHub(); }
    }
    const first = setTimeout(() => { if (!squirrel) void checkGitHub(); }, 15000);
    const interval = setInterval(() => { if (!squirrel) void checkGitHub(); }, 60 * 60 * 1000);
    const onFocus = () => { if (nativeReady) void promptNativeReady(); else if (ready) void promptReady(); else if (pending) void promptRelease(); };
    window.on("focus", onFocus);
    const stop = () => { stopped = true; clearTimeout(first); clearInterval(interval); window.removeListener("focus", onFocus); autoUpdater.removeListener("error", onNativeError); };
    window.once("closed", stop);
    return stop;
}
