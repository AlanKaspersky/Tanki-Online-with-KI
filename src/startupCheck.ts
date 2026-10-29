import Path from "node:path";
import { app, BrowserWindow } from "electron";
import { gameWebPreferences } from "./gameWindow";

/** Offline probe for the actual packaged app, before game/extensions load. */
export async function runStartupCheck(): Promise<void> {
    const timeout = setTimeout(() => app.exit(1), 20000);
    let window: BrowserWindow | undefined;
    try {
        window = new BrowserWindow({ show: false,
            webPreferences: gameWebPreferences(Path.join(__dirname, "preload.js")) });
        if (window.webContents.getBackgroundThrottling() !== false)
            throw new Error("Background rendering preference was not applied");
        await window.loadURL("data:text/html,<html><body>KI startup check</body></html>");
        const renderer = await window.webContents.executeJavaScript('(() => { const canvas=document.createElement("canvas"); const gl=canvas.getContext("webgl2")||canvas.getContext("webgl"); const debug=gl&&gl.getExtension("WEBGL_debug_renderer_info"); const result={isolated:typeof require==="undefined"&&typeof process==="undefined",javascript:Function("return 21*2")()===42,webgl:!!gl,renderer:gl?gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER):null}; gl?.getExtension("WEBGL_lose_context")?.loseContext(); return result; })()');
        if (!renderer.isolated || !renderer.javascript) throw new Error("Packaged renderer startup check failed");
        console.log("KI_STARTUP_CHECK_OK " + JSON.stringify({
            arch: process.arch, electron: process.versions.electron,
            backgroundThrottling: window.webContents.getBackgroundThrottling(),
            translated: app.runningUnderARM64Translation,
            graphics: app.getGPUFeatureStatus(), ...renderer
        }));
        clearTimeout(timeout);
        window.destroy();
        app.exit(0);
    } catch (error) {
        console.error("[KI startup check]", error);
        clearTimeout(timeout);
        if (window && !window.isDestroyed()) window.destroy();
        app.exit(1);
    }
}
