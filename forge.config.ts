import FS from "fs";
import Path from "path";
import { createHash } from "crypto";
import type { ForgeConfig, ForgeMakeResult } from "@electron-forge/shared-types";

const packageJSON = JSON.parse(FS.readFileSync("./package.json",
    { encoding: "utf-8" }));

function includeResource(
    makeResults: Array<ForgeMakeResult>,
    platforms: ReadonlyArray<string> | string,
    resourcePath: string, artifactName: string):
    Array<ForgeMakeResult> {

    if (typeof platforms === "string")
        platforms = [platforms];

    for (const makeResult of makeResults) {
        if (!platforms.some((platform) =>
            platform === makeResult.platform ||
            platform === "*")) continue;
        const artifactPath = Path.resolve(
            Path.dirname(makeResult.artifacts[0]),
            artifactName);
        FS.copyFileSync(resourcePath, artifactPath);
        makeResult.artifacts.push(artifactPath);
    }
    return makeResults;
}

export default {
    packagerConfig: {
        executableName: packageJSON.name,
        asar: true,
        icon: "./resources/icons/icon",
        appCategoryType: "public.app-category.action-games",
        ignore: [/^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/]
    },
    makers: [
        { name: "@electron-forge/maker-zip", platforms: ["darwin"], config: {} },
        {
            name: "@electron-forge/maker-deb",
            config: (arch: string) => ({
                options: {
                    maintainer: "AlanKaspersky",
                    icon: "./resources/icons/icon.png",
                    categories: ["Game"],
                    section: "games",
                    homepage: "https://github.com/AlanKaspersky/Kaspersky-Inventions-for-Tanki-Online",
                }
            })
        },
        {
            name: "@electron-forge/maker-dmg",
            config: (arch: string) => ({
                name: `to-${packageJSON.version}-darwin-${arch}`,
                background: "./resources/dmg-background.png",
                iconSize: 100,
                icon: "./resources/icons/icon.icns"
            })
        },
        {
            name: "@electron-forge/maker-squirrel",
            config: {
                setupExe: `to-${packageJSON.version}-win32.exe`,
                iconUrl: `https://github.com/AlanKaspersky/tanki-online-with-ki/releases/download/${packageJSON.version}/squirrel-icon-${packageJSON.version}.ico`,
                setupIcon: "./resources/icons/icon.ico"
            }
        }
    ],
    hooks: {
        postMake: async (_config: ForgeConfig, makeResults: ForgeMakeResult[]) => {
            includeResource(makeResults, "win32",
                "./resources/icons/icon.ico",
                `squirrel-icon-${packageJSON.version}.ico`);
            for (const result of makeResults) {
                if (result.platform !== "darwin") continue;
                for (let i = 0; i < result.artifacts.length; i++) {
                    const original = result.artifacts[i];
                    if (!original.endsWith(".zip")) continue;
                    const name = `to-${packageJSON.version}-darwin-${result.arch}.zip`;
                    const renamed = Path.join(Path.dirname(original), name);
                    if (original !== renamed) FS.renameSync(original, renamed);
                    result.artifacts[i] = renamed;
                    const sum = renamed + ".sha256";
                    const hash = createHash("sha256");
                    for await (const chunk of FS.createReadStream(renamed)) hash.update(chunk);
                    FS.writeFileSync(sum, `${hash.digest("hex")}  ${name}\n`);
                    result.artifacts.push(sum);
                }
            }
            return makeResults;
        }
    },
    publishers: [
        {
            name: "@electron-forge/publisher-github",
            config: {
                repository: {
                    owner: "AlanKaspersky",
                    name: "tanki-online-with-ki"
                },
                tagPrefix: "",
                draft: false
            }
        }
    ]
} satisfies ForgeConfig;
