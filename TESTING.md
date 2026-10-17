# Update verification — client 1.0.4

## Local commands

```powershell
npm run typecheck
npm test
npm run build
npm run smoke
```

The automated suite uses real ZIP parsing, SHA-256 calculation, streamed file writes, temporary filesystem fixtures, and the actual installer shell script. On Windows the shell cases use Git Bash; Apple-specific `open` results are substituted. Tests check both successful replacement and restoration after rename/open failure, and ensure a running client is never replaced. Temporary fixture deletion is restricted to each test's own temporary directory.

Coverage includes stable/v-prefixed version comparison, architecture-specific assets, missing/duplicate/foreign assets, checksum filenames, partial/oversized/failed downloads, ZIP traversal, escaping symlinks, writing through symlinks, case-folded duplicates, special files, bundle identity/version/CPU checks, write-permission failure, pending-update recovery, RU/EN dialogs, Later/restart choices, hidden windows, window closure, Windows native updater setup, and Forge ZIP/checksum publishing output.

The smoke script launches an invisible Electron window with an isolated temporary profile. It verifies the actual Electron version, disabled renderer Node access, preload IPC and, when `KI_TEST_EXTENSION_PATH` points to an unpacked KI extension, both MAIN-world and isolated extension script loading. HTTPS requests are intercepted locally; no real game/account is loaded. This is a runtime smoke check, not a game performance benchmark.

## macOS boundary

Windows cannot execute Apple's `ditto`, Launch Services (`open`), Gatekeeper, or a macOS Mach-O application. These calls have controlled test doubles in the cross-platform tests. Passing them does **not** certify a complete macOS upgrade on real hardware.

Before calling macOS updating fully verified, check on macOS 13+:

1. Install this client once, outside a mounted DMG or App Translocation. Existing 1.0.3 clients do not contain the new Mac updater and need this initial manual installation.
2. Publish a newer stable test release containing the matching `to-<version>-darwin-<x64|arm64>.zip` and its `.sha256` file; keep DMG for initial/manual installation.
3. Confirm Later leaves the game running. Download the update, choose Later again, restart the client and confirm it reuses the prepared update.
4. Confirm Update and restart waits for the original process to exit, replaces the correct application and reopens it with KI/Discord support intact. Verify on Intel and Apple Silicon, including an application path with spaces.
5. Test a read-only installation, launch from DMG, interrupted download and offline startup. These must not remove the installed application.
6. Verify the previous bundle remains in the hidden `.tanki-ki-update-*/previous.app` directory beside the installed app. The helper restores it if replacement or the OS launch command fails. A later application crash is not automatically diagnosed/rolled back; the retained bundle supports manual recovery.

The updater does not remove quarantine attributes, invoke `sudo`, disable Gatekeeper, or install a signing certificate. SHA-256 protects download integrity; it does not replace Developer ID signing/notarization. Published assets still need a live Mac check. No new CI workflow is installed by this change.

## Verified on Windows — 2026-10-17

- `npm run check`: TypeScript source and Forge configuration pass; 33 tests pass, 0 fail, 0 skip.
- Actual Electron runtime smoke: Electron 44.8.0 / Chromium 152.0.7977.167; renderer Node access disabled, preload IPC working, KI MAIN-world and isolated content scripts loaded.
- Windows x64 application packaged successfully; compiled updater/preload/helper files in app.asar match the checked build, and development tests/scripts are excluded.
- Squirrel installer generated successfully using a temporary ASCII output path. Its version resources report 1.0.4, the RELEASES SHA-1 and size match the full NUPKG, and the NUPKG contains the verified app.asar. Final artifacts are in `out/make/squirrel.windows/x64`.
- The bundled Squirrel resource editor fails on Cyrillic output paths. Use a checkout/output path with Latin characters when building Windows installers; the runtime is not affected by this packaging limitation.
- No release was published, no installer was run on the user profile, and no real macOS app/OS update was executed. Windows native update dialogs use controlled Electron test doubles; live feed delivery requires a published newer release.

## Publication preparation

The GitHub URL policy now accepts owner/repository casing returned by the live GitHub API while keeping tag and asset paths exact. A regression test covers canonical/lowercase URLs and rejects foreign repositories, credentials, URL suffixes and differently cased asset names. Shell files are pinned to LF in .gitattributes so Windows checkout does not invalidate the Mac helper. Local check: 33 tests pass, 0 fail, 0 skip.
