# Tanki Online with KI Client

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

The client operates independently of any web browser, offering improved performance, consistent behavior across platforms, and the ability to distribute custom extensions alongside the application. It features an automatic update mechanism based on Squirrel.Windows on Windows, and manual distribution of DMG packages on macOS and Linux.

The client is designed around a modular main process architecture. Each subsystem, whether it is GPU configuration, extension management, or update handling, is implemented as a self-contained unit that operates independently and reports errors through a unified logging interface.

## Key Features

- Native desktop client for Tanki Online with no browser dependency
- Automatic application updates through GitHub Releases and the Electron public update service
- Automatic extension updates through the Chrome Web Store CRX distribution service
- Support for loading unpacked custom extensions from the user data directory
- GPU acceleration enabled by default on supported hardware
- High-performance GPU preference on systems with multiple graphics adapters
- Cross-platform support for Windows 10 and 11, macOS, and Debian or Ubuntu
- Command line argument support for launching with a custom URL
- External link interception for approved community resources
- Structured error logging through electron-log

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
| 4 | Auto-update initialization | Starts the update check loop on Windows |
| 5 | Chromium switch configuration | Applies performance-related command line switches |
| 6 | Application ready wait | Awaits the Electron ready event |
| 7 | Connection verification | Confirms that the game server is reachable |
| 8 | Extension loading | Updates and loads all extensions into the default session |
| 9 | Main window creation | Opens the primary browser window and loads the game |

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

Purpose: Checks for and downloads new versions of the application from GitHub Releases.

The Auto-Update module uses the update-electron-app library to periodically check the GitHub repository for new releases. The update source is configured through the Electron public update service, which reads the RELEASES file and the NUPKG package from the configured repository.

Update configuration:

| Parameter | Value | Description |
|-----------|-------|-------------|
| updateSource.type | ElectronPublicUpdateService | Uses the public Electron update service |
| updateSource.host | https://update.electronjs.org | The update service endpoint |
| updateSource.repo | AlanKaspersky/Kaspersky-Inventions-for-Tanki-Online | The GitHub repository containing releases |
| updateInterval | 1 hour | Frequency of update checks |
| notifyUser | false | Silently installs updates without dialogs |

The update process works as follows. On application start, and then once per hour, the library sends a request to the update service with the current version, platform, and architecture. The service responds with either an update-available or update-not-available status. When an update is available, the library downloads the NUPKG package and instructs Squirrel.Windows to apply it on the next application start.

For the update mechanism to function correctly, the target GitHub Release must contain two files generated by electron-forge during the make step: the RELEASES manifest and the full NUPKG package. The release tag must follow the semantic versioning format, with a leading v character, for example v1.0.2. The version in the release tag must be greater than the installed version.

Technical Implementation:

- The module is only initialized on Windows
- Errors during update initialization are caught and logged to prevent application crash
- The library automatically tracks whether an update is available and downloads it in the background
- Installation of the downloaded package occurs on the next application start through Squirrel.Windows

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
| Unpacked extension | Directory in userData/extensions with a manifest.json file | Uses the update_url field from the manifest |
| Built-in extension | Registered by public key in the KASPERSKY_EXTENSION_KEY constant | Uses the default Chrome Web Store update service |

The module performs the following steps during application startup.

First, it ensures that the extensions directory exists inside the user data path. If the directory is missing, it is created. This directory is the standard location where users can place unpacked extension folders.

Second, it scans the extensions directory for subdirectories containing a manifest.json file. Each valid extension is added to the processing list.

Third, it checks whether the built-in extension identified by the KASPERSKY_EXTENSION_KEY is already present in the list. If not, it is added with a generated path inside the extensions directory.

Fourth, for each extension in the list, the module calls updateExtension to update it to the latest version, and then loads the updated extension into the default Electron session.

The update process for a single extension depends on its manifest contents.

For extensions with a key field, the module computes the extension ID from the public key using a SHA-256 hash and a character mapping that transforms the hexadecimal digest into an alphabetic string. This computation follows the same algorithm that Chromium uses to derive extension IDs from their public keys.

The module then queries the extension update service for the latest version. If no explicit update_url is provided in the manifest, the module uses the default Chrome Web Store update endpoint. The service responds with an XML document containing the latest version number and the download URL for the CRX file.

If the latest version differs from the currently installed version, the module downloads the CRX file to the temporary directory, unwraps it to extract the underlying ZIP archive, removes the existing extension directory, and extracts the new content into its place.

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

The application update mechanism relies on the Squirrel.Windows framework on Windows and manual distribution on macOS and Linux. The Squirrel framework maintains multiple versions of the application side by side and switches between them on application start. This allows the update process to be reliable and to automatically roll back to the previous version if the new version fails to launch.

Extension update flow:

Extensions are updated independently of the application. On each startup, the extension management module checks the Chrome Web Store for the latest version of each registered extension. If a newer version is available, it is downloaded and installed before the main window is created. This ensures that the user always has access to the latest extension features without requiring a full application update.

File structure:

| Path | Contents |
|------|----------|
| src/main.ts | Main process entry point |
| build/main.js | Compiled main process code |
| resources/icons | Application icons for all platforms |
| out | Build output directory for packaged applications |
| out/make | Final distributable packages |

## Platform Support

Windows:

Windows 10 and Windows 11 on x64 architecture are fully supported. The application supports automatic updates through Squirrel.Windows. GPU acceleration is enabled by default through the GPU respawn mechanism. The installer is distributed as an EXE file generated by the maker-squirrel target.

macOS:

macOS on both x64 and ARM64 architectures is supported. The application is distributed as a DMG file generated by the maker-dmg target. Because the application is not signed with an Apple Developer certificate, users must clear the quarantine attribute using the xattr command before mounting the DMG. Auto-update is not available on macOS in this build.

Linux:

Debian and Ubuntu are supported on x64 and ARM64 architectures. The application is distributed as a DEB package generated by the maker-deb target. The system must have the dpkg and fakeroot packages installed to build the DEB package from source. Auto-update is not available on Linux in this build.

## Installation

Windows:

Download the to-*.*.*-win32.exe installer from the latest release and run it. Squirrel.Windows will install the application and create a Start Menu shortcut. The application is installed to the user local app data directory and does not require administrator privileges.

macOS:

Download the to-1.0.0-darwin-x64.dmg or to-1.0.0-darwin-arm64.dmg file depending on the architecture of your Mac. Before mounting the DMG, clear its quarantine attributes with the following command in Terminal:

```
xattr -c <path to dmg>
```

Then open the DMG and drag the application to the Applications folder. When launching the application for the first time, macOS may display a security warning. To proceed, right-click the application and select Open from the context menu.

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
C:\Users\<username>\AppData\Roaming\tanki_online_with_ki\extensions
```

macOS:

```
/Users/<username>/Library/Application Support/tanki_online_with_ki/extensions
```

Linux:

```
/home/<username>/.config/tanki_online_with_ki/extensions
```

Extensions with a key field in their manifest will be updated automatically through the Chrome Web Store. Extensions with an update_url field will be updated through the configured update service. Extensions without either field will be loaded as-is without updates.

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
| Node.js | 22.x LTS | JavaScript runtime and package manager |
| Git | Any recent version | Source code management |
| npm | Bundled with Node.js | Package management |

On Debian and Ubuntu, the dpkg and fakeroot packages are also required for building DEB packages.

Build steps:

1. Clone the repository:

```
git clone https://github.com/AlanKaspersky/Kaspersky-Inventions-for-Tanki-Online
cd Kaspersky-Inventions-for-Tanki-Online
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

The build process requires Node.js 22 LTS. Newer versions such as Node.js 24 or 26 are not compatible with the yauzl library used by Electron Forge in version 7.6.0. Using an incompatible Node.js version may result in a silent failure during the Finalizing package step of the build process.

## Troubleshooting

Application does not start on Windows:

If the application fails to start and the process appears to exit immediately, the GPU respawn mechanism may be failing. This can be caused by antivirus software blocking the spawn call or by an invalid process path. To diagnose, run the application from the command line and check the log file located at %APPDATA%\tanki_online_with_ki\logs\main.log for errors.

Update check fails with AssertionError:

If the log contains an error message about the host not being a valid HTTPS URL, the update configuration is missing the host field. The Electron public update service requires both host and repo fields to be present in the updateSource object.

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
