# Client release verification

The 1.0.4 sections below record the original updater checks. The final section records stable release 1.0.5 verification.

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

## Windows game-attention checks

The attention suite exercises queue → loader/HUD, delayed loader mounting, cancelled/stopped searches, visible windows, restore/focus acknowledgement, duplicate states, explicit disconnect dialogs, top-level load failures, renderer crashes, navigation and disposal. It rejects foreign senders/frames/URLs and malformed IPC; preload tests retain the existing Discord bridge. Renderer tests run the serialized observer without module imports, check visible markers and RU/EN errors, coalesce mutation bursts, suppress identical snapshots and release resources on pagehide. Non-Windows platforms install no observer/IPC listeners.

For a manual check, start matchmaking and minimize the client. Confirm its Windows taskbar icon requests attention when the battle starts loading; restore it and confirm the signal clears. Repeat with a recognized connection-loss dialog or an unexpected page failure while minimized. Normal startup, visible cancellation and opening the garage must not flash. This does not certify the visual signal on every Windows taskbar configuration.

## Minimized renderer regression — 1.0.6

The game window explicitly disables background throttling through a shared, restricted web-preference factory. The smoke now uses a real minimized Windows window (fully transparent, absent from the taskbar, with no focus). It checks that requestAnimationFrame and timers advance during minimization, then a renderer timer changes queue markup to loading and the real preload/main-process bridge calls flashFrame. Restore clears attention. It no longer substitutes a minimized-state adapter for this path. The packaged offline startup probe also verifies the effective backgroundThrottling preference.

An independent offline comparison on Electron 44.8.0 without the process backgrounding flag reproduced zero new animation frames and one timer tick over 1.5 seconds with the default throttle, versus about 90 frames and 15 ticks when disabled. With the client's existing process flag, the small fixture also continued rendering under the old preferences; the user's full-game stale-frame behavior was not reproduced in that fixture. This change makes the window policy explicit using the supported Electron setting. Actual game behavior on the affected computer remains a manual validation boundary.

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
- The bundled Squirrel resource editor fails on Cyrillic output paths. This initial build used a manual ASCII output workaround; the automatic maker integration documented below now handles ordinary builds. The runtime is not affected by this packaging limitation.
- No release was published, no installer was run on the user profile, and no real macOS app/OS update was executed. Windows native update dialogs use controlled Electron test doubles; live feed delivery requires a published newer release.

## Publication preparation

The GitHub URL policy now accepts owner/repository casing returned by the live GitHub API while keeping tag and asset paths exact. A regression test covers canonical/lowercase URLs and rejects foreign repositories, credentials, URL suffixes and differently cased asset names. Shell files are pinned to LF in .gitattributes so Windows checkout does not invalidate the Mac helper. Local check: 33 tests pass, 0 fail, 0 skip.

## macOS packaging correction — 1.0.5

The 1.0.4 published arm64 ZIP contained the correct CPU architecture and intact download bytes, but no complete top-level app resource seal. The build now applies ad-hoc signing (no Developer ID certificate), preserves hardened runtime with JIT/library-loading entitlements, and fails if signing fails. Post-package verification requires CodeResources, codesign --verify --deep --strict, the expected version and lipo architecture. A matching-architecture runner launches the actual packaged executable with --ki-startup-check to test renderer isolation, JavaScript and report WebGL/GPU status without contacting the game. A cross-architecture build is signature/CPU checked but its runtime check is explicitly reported as not run. Local checks: 35 tests passed, no skips; the new startup probe also passed on real Windows Electron. Gatekeeper/notarization and actual game FPS on a downloaded Mac app still require user-device verification.

## Stable release — 1.0.5 (2026-10-17)

- The existing [release build](https://github.com/AlanKaspersky/Tanki-Online-with-KI/actions/runs/39008921837) completed successfully for Windows and macOS, including all 35 automated tests on each platform.
- The actual packaged arm64 app passed the native offline startup probe on the macOS ARM64 runner: no Rosetta translation, renderer isolation and JavaScript passed, and WebGL used the Apple Metal backend. The x64 build passed signature and architecture checks; it was not launched on an Intel Mac by this build.
- Published Mac ZIP checksums matched GitHub asset digests. The arm64 ZIP also passed an independent check of its main executable code pages, Info.plist signature slot and complete top-level resource seal.
- The user confirmed that all reported problems were resolved on the previously affected Apple Silicon Mac. This is real-device confirmation for that Mac, not a performance benchmark or a claim of a particular FPS on every device.
- Stable publication promotes the existing tested 1.0.5 assets without rebuilding or replacing them. Windows installer/update files and both Mac DMG/ZIP/checksum pairs are included.
- Real Intel runtime behavior and the complete automatic replacement cycle on every supported Mac remain separate validation boundaries; ad-hoc signing does not provide Apple notarization.

## Windows game attention — local verification (2026-10-17)

- `npm run check`: TypeScript and Forge configuration pass; all 47 tests pass, including 12 game-attention tests.
- `npm run build`: passes and includes gameAttention.js/gameDOM.js and the updated preload.
- `npm run smoke`: real Electron 44.8.0 / Chromium 152.0.7977.167 passes. The serialized DOM observer detects synthetic queue/loader markup in the actual renderer, the isolated preload delivers the validated state, and the main process calls the native flashFrame(true)/flashFrame(false) API. Renderer Node access remains disabled and Discord preload IPC still passes.
- The smoke uses an invisible test window and a minimized-state adapter; it does not verify a visible Windows taskbar animation or real matchmaking. No installed client, account or published release is changed by these checks. No GitHub workflow is added.


## Windows EXE rebuild — 1.0.6 (2026-10-17)

- Package/lockfile/README versions are 1.0.6. All 47 tests and type checks pass. The Electron smoke check passes, including the game-attention preload/native-flash path.
- Windows x64 Squirrel EXE and full NUPKG built using a temporary ASCII output path. The packager now explicitly excludes out/ alongside tests/ and scripts/, so old build artifacts cannot be nested in the new app.
- Installer and application PE resources both report 1.0.6. Packaged main, preload, gameAttention, gameDOM and clientUpdates bytes match the compiled sources; the NUPKG contains the exact verified app.asar. RELEASES SHA-1 and size match the generated full NUPKG.
- The actual packaged application passed its offline --ki-startup-check with a separate temporary profile. The installer was not run, no release was published, and real-game matchmaking/taskbar appearance remains a manual check.
- Final installer: out/make/squirrel.windows/x64/to-1.0.6-win32.exe. Artifact hashes and payload/startup verification are recorded alongside it in build-verification-1.0.6.json.


### Background execution verification — rebuilt 1.0.6 (2026-10-17)

All 49 tests and type checks pass. The real Electron minimized-window smoke recorded 90 animation frames and 15 timer ticks over 1.5 seconds; another 13 frames advanced after restore. A renderer timer changed the queue into a loader while minimized, and the native attention path fired and cleared on restore. The rebuilt Windows x64 installer and full NUPKG contain the checked gameWindow/startupCheck and related compiled files; their payload and RELEASES checks pass. The actual packaged executable also passed the offline startup probe and reported backgroundThrottling:false with renderer isolation, JavaScript and WebGL enabled. The EXE in out/make/squirrel.windows/x64/to-1.0.6-win32.exe replaces the previous local 1.0.6 artifact. The installer was not run and no release was published. Confirmation in the affected real game is still required.

### Ordinary Windows make from a Unicode checkout — 1.0.6 (2026-10-17)

- The configured local Squirrel maker stages only the installer phase in an ASCII temporary directory, including the packaged app and setup icon. It returns artifacts to the normal architecture-specific output folder. ASCII inputs delegate directly to the original maker; Mac makers, publishers, dependencies and npm commands are unchanged.
- Seven regression tests cover Unicode app/output/icon paths, ASCII delegation, separate ARM64 output, restoration of configuration after failure, preservation of previous output on native failure, invalid staging paths and unexpected artifact paths. Failed native staging is retained for diagnosis; successful staging is removed with an explicit path guard.
- The ordinary `npm run make -- --platform=win32 --arch=x64` command completed successfully from `C:\Users\james\OneDrive\Рабочий стол\Tanki Online with KI`, including type checks, all 56 tests and a fresh package build. No external build helper or target override was used. DEP0174 warnings remained non-fatal.
- Application and installer PE resources report 1.0.6. The seven checked compiled runtime files match app.asar; tests/scripts/out are excluded. RELEASES SHA-1/size match the full NUPKG, which contains that exact app.asar. The packaged offline startup probe passed with renderer isolation, JavaScript, WebGL and backgroundThrottling:false.
- Fresh EXE, NUPKG, RELEASES and icon are in `out/make/squirrel.windows/x64`; the verification report there contains current artifact hashes. No installer was run and no release was published. ARM64 staging is unit tested; an actual ARM64 installer was not built in this check.

### Taskbar alerts behind another application — 1.0.6 (2026-10-17)

The user confirmed that native attention works when minimized, but not when the game sits behind another application. Attention now accepts either a minimized native window or a window without focus. Search grace handling uses the same condition. Focus acknowledges the signal; a restore without focus retains it. Foreground gameplay never requests attention.

All 59 tests and type checks pass. Added coverage verifies unfocused non-minimized queue-to-loader/HUD transitions, stopped search, focus during the grace period, connection errors and renderer/load failures, with focused-window negative cases. The real Electron smoke calls the native flash API both while minimized and after restore while unfocused, and confirms that restore without focus retains attention. Background rendering still advanced 90 frames/15 timer ticks over 1.5 seconds, with 13 more frames after restore. Tests validate the native calls; the exact taskbar animation remains controlled by Windows and requires a live user check.
