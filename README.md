# Tanki Online with KI Client

Client version: **1.0.7**. Runtime: **Electron 44.8.0** (stable), Chromium 152. macOS minimum: **13 Ventura**.

## Complete Documentation

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Module Documentation](#module-documentation)
   - [Application Bootstrap Module](#application-bootstrap-module)
   - [GPU Acceleration Module](#gpu-acceleration-module)
   - [Auto-Update Module](#auto-update-module)
   - [Connection Verification Module](#connection-verification-module)
   - [Extension Management Module](#extension-management-module)
   - [Main Window Module](#main-window-module)
   - [External Link Handler Module](#external-link-handler-module)
4. [Technical Architecture](#technical-architecture)
5. [Platform Support](#platform-support)
6. [Installation](#installation)
7. [Configuration](#configuration)
8. [Building from Source](#building-from-source)
9. [Troubleshooting](#troubleshooting)
10. [Acknowledgements](#acknowledgements)

## Overview

Tanki Online with KI is a standalone desktop client for the game Tanki Online, built on the Electron framework. The application bundles an up-to-date Chromium engine and provides native support for loading, updating, and managing browser extensions that enhance the game interface.

The client operates independently of any web browser, offering improved performance, consistent behavior across platforms, and the ability to distribute custom extensions alongside the application. It features an automatic update mechanism based on Squirrel.Windows on Windows, and a separate unsigned-app updater on macOS; Linux updates are offered through the release page.

The client is designed around a modular main process architecture. Each subsystem, whether it is GPU configuration, extension management, or update handling, is implemented as a self-contained unit that operates independently and reports errors through a unified logging interface.

## Key Features

- Native desktop client for Tanki Online with no browser dependency
- Application update notifications, native Windows updates and checksum-verified Mac ZIP updates from GitHub Releases
- Automatic extension updates through the Chrome Web Store CRX distribution service
- Support for loading unpacked custom extensions from the user data directory
- GPU acceleration enabled by default on supported hardware
- High-performance GPU preference on systems with multiple graphics adapters
- Cross-platform support for Windows 10 and 11, macOS, and Debian or Ubuntu
- Command line argument support for launching with a custom URL
- External link interception for approved community resources
- Structured error logging through electron-log
- Background game rendering and timers remain active when minimized (`backgroundThrottling: false`)
- Native Windows taskbar attention when a minimized or unfocused client enters a battle after matchmaking, search unexpectedly ends, a connection/kick dialog appears, or the game page fails/crashes

### Background-window game alerts (Windows)

The client calls Electron's native `BrowserWindow.flashFrame(true)` while its window is minimized or lacks focus, including when another application covers it. It never raises or focuses the game window. Focusing the client clears the signal; restoring it behind another window does not. Other platforms are unchanged.

The game window explicitly uses `backgroundThrottling: false` through `src/gameWindow.ts`, shared by the main window and offline startup probe. This keeps animations, timers and loading transitions active when minimized, independently of process priority flags. It also affects page visibility; attention logic therefore checks the native window's minimized and focused states. Background game execution can continue to use CPU/GPU rather than saving that work when minimized.

`src/gameAttention.ts` installs an independent DOM observer on the trusted HTTPS Tanki game page after `dom-ready`. It does not depend on the KI extension or Discord. The isolated preload forwards only five validated boolean fields over `ki:game-attention`; the main process checks the sender, main frame and game URL again. Game selectors live in `src/gameDOM.ts`. No Node API is exposed to the page.

The observer reports visible queue, loader, battle HUD and results markers and common RU/EN connection-loss/kick messages inside dialogs. Mutations are coalesced using a 100 ms timer, including while minimized; unchanged snapshots are not sent. There is no animation-frame loop or periodic polling. A queue-to-loader/HUD transition requests attention once. A 1.5-second grace period allows the queue to unmount before the loader appears; if a background search ends without either screen, attention is requested for the stopped search. Cancelling search while the client has focus does not trigger attention. Normal initial loading, garage loading and battle results alone do not trigger it.

Top-level non-aborted game-page load failures and unexpected renderer termination also request attention. Repeated events do not repeatedly call flashFrame until the player focuses the client. Navigation clears pending search state; window closure removes IPC/window/webContents listeners and timers. Native calls and game rendering are unchanged.

DOM detection is deliberately limited to recognized screen markers and common error dialogs. New game markup or unrecognized/localized error text may require updating this detector. It does not infer a network disconnect merely from a delayed heartbeat or a hidden window. Windows controls the exact flash pattern and duration. Automated tests verify calls and transitions; actual matchmaking and the taskbar appearance require a live minimized-client check.

## Module Documentation

### Application Bootstrap Module

Purpose: Initializes the application, processes startup arguments, and orchestrates the launch sequence.

The Application Bootstrap module represents the entry point of the main process. It performs a series of initialization steps in a strict order, ensuring that each subsystem is ready before the next one begins.

Initialization sequence:

| Step | Action | Description |
|------|--------|-------------|
| 1 | Console redirection | Routes console output through electron-log for unified logging |
| 2 | Squirrel startup check | Detects Squirrel install and uninstall events and terminates early if required |
| 3 | GPU respawn check | Relaunches the application with the correct GPU environment on Windows |
| 4 | Chromium switch configuration | Applies performance-related command line switches |
| 5 | Application ready wait | Awaits the Electron ready event |
| 6 | Connection verification | Confirms that the game server is reachable |
| 7 | Extension loading | Updates and loads all extensions into the default session |
| 8 | Main window creation | Opens the primary browser window and loads the game |
| 9 | Auto-update initialization | Starts platform-specific updates after the main window is ready |

Command line arguments are parsed at startup using the minimist library. The primary supported argument is url, which allows the caller to override the default game URL. This is used both for testing and for launching into alternative game environments.

If the electron-squirrel-startup module detects that the process was invoked by the Squirrel installer for shortcut creation or removal, the application exits immediately without performing any further initialization. This avoids displaying a window during install or uninstall events.

Technical Implementation:

- Startup arguments are parsed with minimist over process.argv
- Console functions are replaced with electron-log equivalents for unified output
- The bootstrap sequence is implemented as a single asynchronous main function
- All errors during initialization are logged through the electron-log main process logger

### GPU Acceleration Module

Purpose: Ensures that the application launches with the correct graphics configuration on Windows systems.

The GPU Acceleration module addresses a common problem on Windows where the operating system assigns the integrated graphics adapter to an Electron application instead of a dedicated GPU. To work around this, the application uses a two-stage launch process on Windows.

On the first launch, the process checks the GPU_SET environment variable. If the variable is not set, the application spawns a copy of itself with the same command line arguments but with two additional environment variables: SHIM_MCCOMPAT set to a compatibility flag that forces the dedicated GPU, and GPU_SET set to true. The original process then exits immediately, and the spawned process continues normal startup.

Because the spawned process inherits the GPU_SET variable, it skips the respawn step and proceeds directly to window creation. This ensures that only one visible instance of the application is created and that it always runs on the high-performance graphics adapter.

The following Chromium switches are applied after the respawn step:

| Switch | Purpose |
|--------|---------|
| disable-renderer-backgrounding | Prevents Chromium from throttling the renderer when the window is not focused |
| force_high_performance_gpu | Requests the discrete GPU on systems with switchable graphics |
| ignore-gpu-blocklist | Allows using GPU features even if the driver is on the Chromium blocklist |
| enable-gpu-rasterization | Enables GPU-accelerated rasterization for improved rendering performance |

Technical Implementation:

- The respawn logic is skipped on macOS and Linux
- The spawn call uses the detached option and stdio ignore to decouple the child process
- The unref method is called on the child process so that the parent can exit without waiting
- Environment variables are inherited from the current process and extended with the GPU-specific values

### Auto-Update Module

Application updates come from the public [client releases](https://github.com/AlanKaspersky/tanki-online-with-ki/releases), independently of Chrome Web Store extension updates. Development builds do not check/install application updates. Dialogs use Russian or English according to the OS locale. Restart is always an explicit choice, with Later as the default/cancel action.

**Windows installed with Squirrel:** the existing Electron update service checks at startup and hourly, downloads the update and offers Update and restart / Later. A downloaded-update notice waits while the main window is hidden. Releases must contain `RELEASES`, `*-full.nupkg` and the installer EXE. If the native updater reports an error, a GitHub release-page offer provides a manual fallback. Portable Windows and Linux builds receive a release-page notification rather than an unsupported automatic installation.

**macOS without Developer ID:** builds use an ad-hoc signature to seal the completed application and nested components. This does not identify the developer to Apple or provide notarization. The packaging step fails on signature verification errors and verifies the final bundle architecture. It also launches the packaged executable offline on a matching runner architecture before producing installers.

The updater checks GitHub 15 seconds after the main window is ready, then hourly. It ignores drafts, prereleases, same/older versions and incompatible asset names. For Intel/Apple Silicon, the release must contain:

- `to-<version>-darwin-x64.zip` and `to-<version>-darwin-x64.zip.sha256`;
- `to-<version>-darwin-arm64.zip` and `to-<version>-darwin-arm64.zip.sha256`.

Forge now produces these alongside the existing DMGs, and publishes the architecture-specific checksum files. Publish the complete release before announcing it. DMGs remain the initial/manual installation format; the ZIP/checksum pair is required for automatic Mac updates.

After Download update, the client downloads in the background and checks size, SHA-256, archive paths/links, bundle identifier, executable name, version and CPU architecture. Preparation never overwrites the running app. It then asks separately whether to restart. Choosing Later retains the prepared update in the application's user-data update state for the next launch.

After explicit restart confirmation, a separate POSIX helper waits up to 120 seconds for the current process to exit. It retains the previous bundle, moves the prepared app into place and calls macOS Launch Services. Rename/open-command failure restores the old app. A later crash after a successful launch command is not automatically detected; the previous app remains available for manual recovery. Backups are kept under a hidden `.tanki-ki-update-*/previous.app` directory beside the installed app and can be removed manually after successful verification.

The app must be installed outside a DMG/App Translocation and its installation directory must be writable by the current user. Otherwise preparation stops and offers manual installation from GitHub. The updater does not request administrator rights or remove macOS quarantine/security settings. It does not provide Developer ID signing/notarization. Clients older than 1.0.4 need one manual Mac upgrade before this mechanism is available. If the 1.0.4 Mac bundle is blocked as damaged, manually replace it with 1.0.5; use arm64 on Apple M-series Macs and x64 on Intel Macs.

See [TESTING.md](TESTING.md) for automated coverage and the remaining real-Mac verification boundary. The official native Electron autoUpdater requires signed Mac apps; the unsigned Mac path described here is a separate implementation.

### Connection Verification Module

Purpose: Verifies that the game server is reachable before displaying the main window.

The Connection Verification module performs a series of HTTP requests to the game server before initializing the user interface. If the server is not reachable after a fixed number of attempts, the application displays an error dialog and exits.

Connection parameters:

| Parameter | Value | Description |
|-----------|-------|-------------|
| URL | https://tankionline.com/play/ | The game entry point |
| Attempts | 3 | Number of connection tries before failure |
| Timeout | 5000 ms | Timeout for each connection attempt |

The module uses the built-in fetch API with an AbortSignal timeout. If any of the attempts succeeds, the function returns true and the application continues. If all attempts fail, the function returns false and the caller displays a bilingual error dialog before quitting.

Technical Implementation:

- Uses the global fetch API available in modern Electron versions
- Applies an AbortSignal.timeout for each request to prevent indefinite hangs
- Errors during each attempt are silently ignored and the next attempt begins
- The dialog is displayed with dialog.showErrorBox and contains text in both English and Russian

### Extension Management Module

Purpose: Updates, loads, and manages browser extensions used by the client.

The Extension Management module is responsible for the lifecycle of all extensions used by the application. It supports two types of extensions: unpacked extensions provided by the user in the user data directory, and packaged extensions distributed through the Chrome Web Store.

Extension source resolution:

| Extension source | Detection method | Update method |
|------------------|------------------|---------------|
| Managed KI | Matches KASPERSKY_EXTENSION_KEY; canonical store directory wins among duplicates | Chrome Web Store update service, with retained public key after extraction |
| Other keyed extension | Manifest contains a public key | Configured update_url or the default Chrome Web Store endpoint |
| Other unpacked extension | Manifest has no public key | Loaded as-is; update_url alone cannot supply the extension ID |

The module performs the following steps during application startup.

First, it ensures that the extensions directory exists inside the user data path. If the directory is missing, it is created. This directory is the standard location where users can place unpacked extension folders.

Second, it scans the extensions directory for subdirectories containing a manifest.json file. Each valid extension is added to the processing list.

Third, selectExtensions chooses KI by its registered public key. A keyless copy with the KI name is skipped, regardless of its version. If no managed copy exists, the client reserves a free managed directory and downloads the official copy there. Existing local, invalid and unrelated directories are never selected as that new download target.

Fourth, each selected extension is checked for updates and loaded. An update-check failure is logged separately and still permits loading an installed copy; failure to load one extension does not stop the others. KI duplicate paths are logged and skipped.

The update process for a single extension depends on its manifest contents.

For extensions with a key field, the module computes the extension ID from the public key using a SHA-256 hash and a character mapping that transforms the hexadecimal digest into an alphabetic string. This computation follows the same algorithm that Chromium uses to derive extension IDs from their public keys.

The module then queries the extension update service for the latest version. If no explicit update_url is provided in the manifest, the module uses the default Chrome Web Store update endpoint. The service responds with an XML document containing the latest version number and the download URL for the CRX file.

If the reported store version differs, the module downloads and unwraps the CRX, extracts to a separate sibling staging directory, validates the manifest version/public key and retains the registered key even when the packed manifest omitted it. Only then does it replace the installed directory. A failed final rename restores the previous directory; if restoration itself fails, the previous directory is retained for recovery. Owned staging/temp archives are cleaned.

Technical Implementation:

- The extension ID derivation uses the SHA-256 hash of the public key DER encoding
- The CRX unwrapping process handles both CRX2 and CRX3 formats
- ZIP entry permissions are corrected to work around inconsistencies in the CRX archive format
- Errors during extension update are logged but do not prevent other extensions from loading

CRX unwrapping procedure:

The CRX format prepends a header to a standard ZIP archive. The header size depends on the CRX version. For CRX2, the header is 16 bytes plus the lengths of the public key and signature sections. For CRX3, the header is 12 bytes plus the length of the header data. The unwrapCRX function detects the format by reading the magic number at the start of the buffer, then computes the correct offset at which the ZIP archive begins.

If the buffer already starts with a ZIP signature, the function returns the buffer unchanged. This handles the case where a raw ZIP archive is used instead of a CRX package.

ZIP permission correction:

Some CRX archives contain incorrect permission flags for directory entries. The fixZipEntryPermissions function detects directories by examining the external file attributes and the file name suffix, then applies standard Unix-style permissions. Files receive 0o644 and directories receive 0o755. This ensures that extracted extensions behave consistently across platforms.

### Main Window Module

Purpose: Creates and configures the primary application window.

The Main Window module is responsible for instantiating the BrowserWindow, configuring its properties, and loading the game URL. The window configuration is platform-aware and adapts its appearance based on the operating system.

Window configuration:

| Parameter | Value | Description |
|-----------|-------|-------------|
| Width | 1280 | Initial window width in pixels |
| Height | 800 | Initial window height in pixels |
| Title | Tanki Online with KI | Window title |
| Title bar style | customButtonsOnHover on macOS, default elsewhere | Controls the title bar appearance |
| Menu bar | Hidden | The application menu bar is disabled |

The window is created with the show property set to false, which prevents the window from being displayed until the content is ready. When the ready-to-show event fires, the window is maximized to fill the screen.

Platform-specific icon configuration:

On Windows, the window icon is loaded from resources/icons/icon.ico relative to the application path. On Linux, the equivalent icon is loaded from resources/icons/icon.png. On macOS, the icon is embedded in the application bundle during the build process and does not need to be set at runtime.

The window loads the URL specified in the url command line argument if present, or the default game URL otherwise. This allows the application to be launched against alternative game environments when needed.

Technical Implementation:

- The window is created with a fixed initial size but can be resized by the user
- The title bar style on macOS uses customButtonsOnHover for a cleaner appearance
- The menu bar is hidden to provide a more game-like interface
- The window is maximized after the ready-to-show event to avoid visual flickering

### External Link Handler Module

Purpose: Handles window.open and target="_blank" events by opening approved URLs in the system browser.

The External Link Handler module intercepts all window open requests from the renderer process. If the URL is present in a predefined allowlist of community resources, the URL is opened in the system default browser using shell.openExternal. Otherwise, the request is allowed to proceed inside the application.

The current allowlist contains the following URLs:

| URL | Purpose |
|-----|---------|
| https://github.com/AlanKaspersky/Kaspersky-Inventions-for-Tanki-Online | The extension repository |

Any URL not present in the allowlist is opened within the application in a new BrowserWindow. This preserves functionality for game features that rely on opening secondary windows, such as payment processing or support pages.

Technical Implementation:

- Uses the setWindowOpenHandler method on webContents to intercept window creation
- Returns action deny for allowlisted URLs after calling shell.openExternal
- Returns action allow for all other URLs, preserving default behavior
- The allowlist is defined as a constant array at the top of the main file

## Technical Architecture

The application follows a standard Electron architecture with a main process and one or more renderer processes. The main process is responsible for all application logic described in this document. The renderer process simply displays the game content loaded from the remote URL.

Process flow:

| Stage | Process | Action |
|-------|---------|--------|
| 1 | Main | Parse command line arguments and initialize logging |
| 2 | Main | Check for Squirrel startup events and GPU respawn requirements |
| 3 | Main | Initialize the auto-update module on Windows |
| 4 | Main | Apply Chromium switches and wait for the ready event |
| 5 | Main | Verify connection to the game server |
| 6 | Main | Update and load all extensions |
| 7 | Main | Create the main window and load the game URL |
| 8 | Renderer | Display the game and communicate with the server |

Update mechanism:

Application updating uses Squirrel.Windows on installed Windows clients, a separate staged ZIP replacement on macOS, and release-page notifications on Linux. See the Auto-Update module for recovery boundaries and required assets.

Extension update flow:

Extensions are updated independently of the application. On each startup, the extension management module checks the Chrome Web Store for the latest version of each registered extension. If a newer version is available, it is downloaded and installed before the main window is created. This ensures that the user always has access to the latest extension features without requiring a full application update.

File structure:

| Path | Contents |
|------|----------|
| src/main.ts | Main process entry point |
| src/clientUpdates.ts | Update scheduling and dialogs |
| src/releasePolicy.ts | Stable release/asset validation |
| src/macUpdates.ts | Verified Mac download/preparation |
| resources/mac-update.sh | Post-exit Mac replacement and rollback helper |
| TESTING.md | Test commands and platform verification limits |
| build/main.js | Compiled main process code |
| resources/icons | Application icons for all platforms |
| out | Build output directory for packaged applications |
| out/make | Final distributable packages |

## Platform Support

Windows:

Windows 10 and Windows 11 on x64 architecture are fully supported. The application supports automatic updates through Squirrel.Windows. GPU acceleration is enabled by default through the GPU respawn mechanism. The installer is distributed as an EXE file generated by the maker-squirrel target.

macOS:

Electron 44 requires macOS 13 Ventura or newer. Both Intel x64 and Apple Silicon ARM64 builds are produced. DMGs support initial/manual installation; architecture-specific ZIP/checksum pairs support subsequent automatic updates. The completed app is ad-hoc signed, without a Developer ID certificate or notarization; macOS security/initial-opening requirements still apply. See the Auto-Update module and TESTING.md for validation and update details.

Linux:

Debian and Ubuntu are supported on x64 and ARM64 architectures. The application is distributed as a DEB package generated by the maker-deb target. The system must have the dpkg and fakeroot packages installed to build the DEB package from source. Auto-update is not available on Linux in this build.

## Installation

Windows:

Download the to-*.*.*-win32.exe installer from the latest release and run it. Squirrel.Windows will install the application and create a Start Menu shortcut. The application is installed to the user local app data directory and does not require administrator privileges.

macOS:

Download the matching installer from the [latest stable release](https://github.com/AlanKaspersky/Tanki-Online-with-KI/releases/latest): to-1.0.7-darwin-arm64.dmg for Apple M-series Macs, or to-1.0.7-darwin-x64.dmg for Intel Macs. Open the DMG and drag the app into Applications. Fully quit any existing client before replacing it.

The application is ad-hoc signed but is not Developer ID signed or notarized. If macOS blocks the first launch, review its warning and use the application-specific approval in System Settings > Privacy & Security if available. The updater does not change macOS security settings.

If version 1.0.4 cannot launch, replace it manually with the matching 1.0.5 build. Version 1.0.5 was verified on the previously affected Apple Silicon Mac; the user confirmed that the reported problems were resolved.

Linux:

Download the DEB package from the latest release and install it with the following command:

```
sudo dpkg -i tanki-online-with-ki_1.0.0_amd64.deb
```

If the installation reports missing dependencies, resolve them with:

```
sudo apt install -f
```

## Configuration

Command line arguments:

The application accepts the following command line arguments:

| Argument | Description |
|----------|-------------|
| --url | Specifies the URL to load instead of the default game URL |

The url argument is useful for testing and for launching the client into alternative game environments. It can be combined with the built-in URL allowlist to control which external resources are opened in the system browser.

Custom extensions:

The client supports loading custom unpacked extensions. To add an extension, place its directory containing a manifest.json file into the following location:

Windows:

```
C:\Users\<username>\AppData\Roaming\Tanki Online with KI\extensions
```

macOS:

```
/Users/<username>/Library/Application Support/Tanki Online with KI/extensions
```

Linux:

```
/home/<username>/.config/Tanki Online with KI/extensions
```

Extensions with a key are checked through update_url when present, otherwise the default store endpoint. A keyless extension does not become updateable merely by declaring update_url. KI is managed specially: local/keyless KI copies have no priority and are skipped in favor of a keyed store copy, or a new store download. Other keyless extensions still load normally.

Registry entries on Windows:

The Squirrel.Windows installer creates the following registry entries:

| Path | Purpose |
|------|---------|
| HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\tanki_online_with_ki | Uninstall information |
| HKCU\Software\AlanKaspersky\tanki_online_with_ki | Application metadata |

Application data location:

The application stores its data in the standard Electron user data directory. On Windows, this is located at:

```
%APPDATA%\tanki_online_with_ki
```

This directory contains the logs, extensions, cache, and other application-specific data.

## Building from Source

Prerequisites:

The following tools must be installed on the build machine:

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22.12.0 or newer | JavaScript runtime and package manager |
| Git | Any recent version | Source code management |
| npm | Bundled with Node.js | Package management |

On Debian and Ubuntu, the dpkg and fakeroot packages are also required for building DEB packages.

Build steps:

1. Clone the repository:

```
git clone https://github.com/AlanKaspersky/tanki-online-with-ki
cd tanki-online-with-ki
```

2. Install dependencies:

```
npm ci
```

3. Build the TypeScript sources:

```
npm run build
```

4. Generate platform-specific distributables:

```
npm run make
```

Windows builds now support checkout/output paths containing Cyrillic or other non-ASCII characters. The configured `scripts/maker-squirrel.cjs` delegates to the existing Squirrel maker using a private ASCII staging directory for the app, installer output and setup icon, then returns the installer/update artifacts to the normal `out/make/squirrel.windows/<arch>` folder. This applies to ordinary `npm run make` and `npm run publish`; no separate manual helper or source-folder move is required. ASCII-only builds use the original maker directly. Successful staging is cleaned; failed staging is retained with its path printed for diagnosis. If the Windows temporary directory itself contains non-ASCII characters, set `KI_SQUIRREL_TEMP_DIR` to an absolute writable ASCII directory before building. Dependencies, signing and publisher settings are unchanged.

The output is placed in the out/make directory. The structure of this directory depends on the current platform. On Windows, the Squirrel installer and the NUPKG package are placed in out/make/squirrel.windows/x64. On macOS, the DMG file is placed in out/make. On Linux, the DEB package is placed in out/make/deb.

Platform-specific build commands:

| Command | Target |
|---------|--------|
| npm run make-windows | Windows x64 and ARM64 |
| npm run make-macos | macOS x64 and ARM64 |
| npm run make | Current platform only |

GitHub Actions:

The repository can be configured to build on GitHub Actions. A typical workflow builds on the three supported platforms in parallel and uploads the resulting packages as artifacts. Building on macOS requires additional configuration for code signing if distribution outside the developer community is intended.

Node.js version compatibility:

Electron 44 npm tooling requires Node.js 22.12.0 or newer. The dependency lockfile pins the runtime and ZIP libraries. Run type checking, tests and a local packaging check before release; do not infer compatibility from the Node.js major version alone.

## Troubleshooting

Application does not start on Windows:

If the application fails to start and the process appears to exit immediately, the GPU respawn mechanism may be failing. This can be caused by antivirus software blocking the spawn call or by an invalid process path. To diagnose, run the application from the command line and check the log file located at %APPDATA%\Tanki Online with KI\logs\main.log for errors.

Update check fails with AssertionError:

If the log contains an error message about the host not being a valid HTTPS URL, the update configuration is missing the host field. The Electron public update service requires both host and repo fields to be present in the updateSource object.

Squirrel fails with `Fatal error: Unable to load file`:

The legacy resource editor cannot open Unicode paths. Use the repository's configured maker through `npm run make -- --platform=win32 --arch=x64`; explicitly overriding the target with `@electron-forge/maker-squirrel` bypasses the automatic staging. Inspect the printed staging path and native error if it still fails. `DEP0174` promisify messages are warnings, not the resource-editor failure. `Debugger attached` / `Waiting for the debugger to disconnect` indicates an active Node debugger; disable terminal auto-attach or run from a terminal without a debugger if that prevents the process from exiting. Do not change antivirus/security settings just for these warnings.

Build hangs on Finalizing package:

If the build process hangs at the Finalizing package step and then exits with code 1, the most likely cause is a Node.js version incompatibility. Verify that Node.js 22 LTS is installed and active. Other possible causes include insufficient memory and antivirus interference. Increasing the maximum heap size with NODE_OPTIONS and adding the project directory to antivirus exclusions can help diagnose the issue.

Extensions do not load:

If extensions are not loading, verify that the extension directories contain a valid manifest.json file. Check the log file for errors related to extension loading. The most common issues are missing key or update_url fields in the manifest, or errors during the CRX download and extraction process.

Game server unreachable:

If the application displays an error dialog about server connectivity and exits, the game server may be temporarily unavailable, or the network connection may be blocked. The application performs three connection attempts with a five second timeout each before giving up. If the server is reachable through a browser but not through the application, a firewall or proxy may be interfering with the request.

## Acknowledgements

The Tanki Online with KI client is a fork of the Tanki Tweaks Client originally developed by tettov. The client builds on the original architecture and adds support for the Kaspersky's Inventions extension and related features.

The Kaspersky's Inventions extension was developed with the assistance of various AI models including ChatGPT, DeepSeek, Claude Sonnet 5, Claude Haiku 4.5, Gemini 3.5 Flash-Lite, Gemini 3.8 Flash, Gemini 3.1 Pro, and Grok 4.6. Quality assessment was performed by Claude Fable 5.1 and Claude Opus 5.

The application uses the following open source libraries:

| Library | Purpose |
|---------|---------|
| Electron | Application framework |
| electron-forge | Build and distribution tooling |
| electron-log | Logging |
| electron-squirrel-startup | Squirrel.Windows event handling |
| update-electron-app | Automatic application updates |
| nodejs-file-downloader | Extension CRX downloads |
| extract-zip | ZIP archive extraction |
| fast-xml-parser | Parsing of extension update responses |
| minimist | Command line argument parsing |
| yauzl | ZIP archive reading |

Documentation Version 1.0

## KI extension update selection — October 22, 2026

The managed store copy always wins over a same-name keyless KI copy. The canonical path is extensions/kaspersky-inventions. If occupied by a local copy, a separate free kaspersky-inventions-store (or numbered suffix) is used; existing local files are preserved but not loaded as KI. A downloaded CRX can omit manifest.key, so the registered key is written to the extracted manifest for the next startup. Version checks still contact the extension update service independently of the client executable updater.

The update is prepared before replacement; failed checks/downloads/validation leave the installed directory intact. Private .ki-extension-update-* staging/backup directories are not loaded as extensions. A previous directory retained after a failed restore must be recovered manually; it is not silently deleted at startup. Tests use controlled files/network doubles and do not change an installed profile. Rebuilding source does not modify a running installed executable or publish a client update.
