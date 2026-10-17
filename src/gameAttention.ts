import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron';
import { gameDOM } from './gameDOM';

export interface AttentionState {
    searching: boolean;
    loading: boolean;
    battle: boolean;
    results: boolean;
    disconnected: boolean;
}

export function validAttentionState(value: unknown): value is AttentionState {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && ['searching', 'loading', 'battle', 'results', 'disconnected']
            .every(key => typeof (value as Record<string, unknown>)[key] === 'boolean');
}

export function isGameAttentionURL(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && /(^|\.)tankionline\.com$/.test(url.hostname)
            && (url.pathname === '/play' || url.pathname.startsWith('/play/'));
    } catch { return false; }
}

// Serialized into the game page. Keep this function self-contained; no imports/free variables.
export function observeGameAttention(selectors: typeof gameDOM.attention): void {
    let last = '', timer = 0, stopped = false;
    const visible = (element: Element) => element.getClientRects().length > 0
        && !element.closest('[hidden], [aria-hidden="true"]');
    const present = (selector: string) => Array.from(document.querySelectorAll(selector)).some(visible);
    const connectionError = /(?:соединени[ея][\s\S]{0,80}(?:потерян|разорван|прерван)|(?:потерян|разорван)[\s\S]{0,40}соединени|отключены от сервера|исключены из (?:игры|битвы)|вы были (?:отключены|исключены)|сервер (?:недоступен|перезагружается)|ошибка (?:подключения|соединения)|connection[\s\S]{0,80}(?:lost|closed|terminated|failed)|(?:lost|failed)[\s\S]{0,40}connection|disconnected from (?:the )?server|you (?:have been|were) (?:kicked|disconnected|removed)|server (?:is )?(?:unavailable|restarting))/i;
    const scan = () => {
        timer = 0;
        if (stopped) return;
        try {
            const state = {
                searching: present(selectors.searching), loading: present(selectors.loading),
                battle: present(selectors.battle), results: present(selectors.results),
                disconnected: Array.from(document.querySelectorAll(selectors.dialogs)).some(element =>
                    visible(element) && connectionError.test((element.textContent || '').slice(0, 2048))),
            };
            const key = JSON.stringify(state);
            if (key !== last) {
                last = key;
                window.postMessage({ type: 'ki:game-attention', version: 1, state }, window.location.origin);
            }
        } catch (error) {
            console.warn('[KI Attention] Cannot inspect game screen:', error);
        }
    };
    const observer = new MutationObserver(() => {
        // Timers keep working in a minimized window; rAF can be suspended there.
        if (!timer && !stopped) timer = window.setTimeout(scan, 100);
    });
    observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
    const stop = () => { stopped = true; observer.disconnect(); window.clearTimeout(timer); timer = 0; };
    window.addEventListener('pagehide', stop, { once: true });
    scan();
}

export function installGameAttention(window: BrowserWindow, ipcMain: IpcMain,
    report: (message: string) => void = () => {}, platform: NodeJS.Platform = process.platform): () => void {
    if (platform !== 'win32') return () => {};
    let previous: AttentionState | null = null, searching = false, active = false;
    let flashing = false, disposed = false, generation = 0;
    let searchEnded: ReturnType<typeof setTimeout> | undefined;
    const web = window.webContents;
    const inBackground = () => window.isMinimized() || !window.isFocused();
    const cancelSearchEnd = () => { clearTimeout(searchEnded); searchEnded = undefined; };
    const notify = (reason: string) => {
        if (disposed || window.isDestroyed() || !inBackground() || flashing) return;
        try { window.flashFrame(true); flashing = true; report('[KI Attention] ' + reason); }
        catch (error) { report('[KI Attention] Cannot flash taskbar: ' + String(error)); }
    };
    const acknowledge = () => {
        if (flashing && !window.isDestroyed()) {
            try { window.flashFrame(false); } catch { /* Closing window. */ }
        }
        flashing = false;
    };
    const reset = () => {
        generation++;
        cancelSearchEnd();
        previous = null; searching = false; active = false;
    };
    const receive = (event: IpcMainEvent, value: unknown) => {
        if (disposed || event.sender !== web || event.senderFrame !== web.mainFrame
            || !isGameAttentionURL(event.senderFrame.url) || !validAttentionState(value)) return;
        // Own the state: do not retain objects received through IPC.
        const state = { searching: value.searching, loading: value.loading, battle: value.battle,
            results: value.results, disconnected: value.disconnected };
        if (state.searching || state.battle) active = true;
        if (state.disconnected) {
            if (!previous?.disconnected && active) notify('Game connection lost / removed from the game');
            searching = false; cancelSearchEnd();
        } else if (state.searching) {
            searching = true; cancelSearchEnd();
        } else if (searching && (state.loading || state.battle)) {
            searching = false; cancelSearchEnd();
            notify('Match found: entering the battle');
        } else if (searching && !searchEnded) {
            // React may remove the queue before mounting the battle loader.
            if (inBackground()) {
                searchEnded = setTimeout(() => {
                    searchEnded = undefined; searching = false;
                    notify('Match search ended without entering a battle');
                }, 1500);
            } else searching = false;
        }
        previous = state;
    };
    const inject = () => {
        if (disposed || !isGameAttentionURL(web.getURL())) return;
        const current = generation;
        const code = '(' + observeGameAttention.toString() + ')(' + JSON.stringify(gameDOM.attention) + ');';
        void web.executeJavaScript(code).catch(error => {
            if (!disposed && current === generation) report('[KI Attention] Observer unavailable: ' + String(error));
        });
    };
    const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
        if (mainFrame && !inPlace) reset();
    };
    const failed = (_event: unknown, code: number, _description: string, url: string, mainFrame: boolean) => {
        if (mainFrame && code !== -3 && isGameAttentionURL(url)) notify('Game page failed to load');
    };
    const gone = (_event: unknown, details: Electron.RenderProcessGoneDetails) => {
        if (details.reason !== 'clean-exit' && isGameAttentionURL(web.getURL())) notify('Game renderer stopped');
        reset();
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true; reset(); acknowledge();
        ipcMain.removeListener('ki:game-attention', receive);
        window.removeListener('focus', acknowledge);
        window.removeListener('closed', dispose);
        web.removeListener('dom-ready', inject); web.removeListener('did-start-navigation', navigate);
        web.removeListener('did-fail-load', failed); web.removeListener('render-process-gone', gone);
    };
    ipcMain.on('ki:game-attention', receive);
    window.on('focus', acknowledge); window.once('closed', dispose);
    web.on('dom-ready', inject); web.on('did-start-navigation', navigate);
    web.on('did-fail-load', failed); web.on('render-process-gone', gone);
    return dispose;
}
