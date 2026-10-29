import type { Session } from 'electron';

/**
 * Electron does not guarantee support for the extension's MV3 DNR rules.
 * Redirect only the actual game entry bundle to KI's packaged gate, mirroring
 * rules/game-bundle.json. Query-bearing requests (in particular ki_native=1)
 * must remain native or the loader will recursively intercept its own fetch.
 */
const BUNDLE_HOSTS = new Set([
    's.eu.tankionline.com',
    's.ru.tankionline.com',
    'test-eu.tankionline.com',
    'test-ru.tankionline.com'
]);
const BUNDLE_PATH = /^\/(?:browser-public\/)?static\/js\/main\.[a-z0-9_-]+\.js$/i;
const BUNDLE_RESOURCE_TYPES = new Set(['script', 'xhr', 'other']);

type RequestDetails = { url: string; resourceType: string; method?: string };

export function isKiGameBundleRequest(details: RequestDetails): boolean {
    if (!details || !BUNDLE_RESOURCE_TYPES.has(details.resourceType) ||
        (details.method && details.method.toUpperCase() !== 'GET')) return false;
    try {
        const url = new URL(details.url);
        return (url.protocol === 'https:' || url.protocol === 'http:') &&
            BUNDLE_HOSTS.has(url.hostname.toLowerCase()) &&
            BUNDLE_PATH.test(url.pathname) && !url.search;
    } catch {
        return false;
    }
}

/** Install once, after loading the KI extension, before game navigation. */
export function installKiGameGate(
    gameSession: Session,
    extensionId: string,
    report: (source: string, resourceType: string) => void = () => {}
): string {
    if (!/^[a-p]{32}$/.test(extensionId)) {
        throw new Error('The loaded KI extension did not return a valid extension ID');
    }
    const gateURL = `chrome-extension://${extensionId}/dist/kasp_game_gate.js`;
    // Electron supports only one onBeforeRequest handler per session; do not
    // register a second handler here without combining their logic first.
    gameSession.webRequest.onBeforeRequest({ urls: ['*://*.tankionline.com/*'] }, (details, callback) => {
        if (!isKiGameBundleRequest(details)) {
            callback({});
            return;
        }
        try { report(details.url, details.resourceType); } catch { /* logging must never block the game */ }
        callback({ redirectURL: gateURL });
    });
    return gateURL;
}
