export const CLIENT_REPOSITORY = "AlanKaspersky/Tanki-Online-with-KI";
export const RELEASE_API = `https://api.github.com/repos/${CLIENT_REPOSITORY}/releases/latest`;
export const RELEASE_PAGE = `https://github.com/${CLIENT_REPOSITORY}/releases/latest`;
export interface ReleaseAsset { name: string; url: string; size: number; }
export interface ClientRelease { version: string; page: string; zip?: ReleaseAsset; checksum?: ReleaseAsset; }

export function versionParts(value: unknown): number[] | null {
    if (typeof value !== "string") return null;
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/.exec(value);
    if (!match) return null;
    const parts = match.slice(1, 4).map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
}
export function newerVersion(candidate: string, installed: string): boolean {
    const next = versionParts(candidate), current = versionParts(installed);
    if (!next || !current) return false;
    for (let i = 0; i < 3; i++) if (next[i] !== current[i]) return next[i] > current[i];
    return false;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function sameGitHubURL(value: unknown, expected: string): boolean {
    if (typeof value !== "string") return false;
    const normalize = (input: string): string | null => {
        try {
            const url = new URL(input);
            if (url.origin !== "https://github.com" || url.username || url.password) return null;
            const parts = url.pathname.split("/");
            // GitHub owner/repository names are case-insensitive; tags and asset names are not.
            if (parts.length < 3) return null;
            parts[1] = parts[1].toLowerCase(); parts[2] = parts[2].toLowerCase();
            return url.origin + parts.join("/") + url.search + url.hash;
        } catch { return null; }
    };
    const normalized = normalize(value);
    return normalized !== null && normalized === normalize(expected);
}
export function readClientRelease(value: unknown, installed: string, arch: string): ClientRelease | null {
    if (!object(value) || value.draft !== false || value.prerelease !== false || typeof value.tag_name !== "string"
        || !newerVersion(value.tag_name, installed) || !Array.isArray(value.assets) || value.assets.length > 100) return null;
    const version = versionParts(value.tag_name)!.join(".");
    const assets = value.assets;
    const tag = value.tag_name;
    const page = `https://github.com/${CLIENT_REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`;
    if (!sameGitHubURL(value.html_url, page)) return null;
    const result: ClientRelease = { version, page };
    if (arch !== "arm64" && arch !== "x64") return result;
    const zipName = `to-${version}-darwin-${arch}.zip`;
    const find = (name: string, limit: number): ReleaseAsset | undefined => {
        const matches = assets.filter(asset => object(asset) && asset.name === name);
        if (matches.length !== 1) return;
        const asset = matches[0];
        const expected = `https://github.com/${CLIENT_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${name}`;
        if (!sameGitHubURL(asset.browser_download_url, expected) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > limit) return;
        return { name, url: expected, size: asset.size };
    };
    result.zip = find(zipName, 700 * 1024 * 1024);
    result.checksum = find(zipName + ".sha256", 512);
    return result;
}

export function readChecksum(text: string, filename: string): string {
    const match = /^([a-fA-F0-9]{64})  ([^\r\n]+)\r?\n?$/.exec(text);
    if (!match || match[2] !== filename) throw new Error("Invalid update checksum file");
    return match[1].toLowerCase();
}

export function safeArchiveEntry(name: string, appName: string): boolean {
    return name.length <= 4096 && !/[\\\x00-\x1f]/.test(name) && name.startsWith(appName + "/")
        && !name.split("/").some(part => part === ".." || part === ".") && !name.includes("//");
}
