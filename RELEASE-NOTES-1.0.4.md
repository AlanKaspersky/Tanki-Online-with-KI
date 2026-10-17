## What's Changed

- Updated the client runtime from Electron 33 to Electron 44.8.0 with Chromium 152.
- Updated extension loading to the current Electron API and verified KI loading in both MAIN and isolated worlds.
- Added Russian and English update notifications with an explicit restart choice.
- Kept native Squirrel auto-updates for installed Windows clients, with a GitHub release-page fallback when native updating fails.
- Added a separate updater for unsigned macOS applications, with Intel and Apple Silicon downloads, SHA-256 verification, archive and bundle validation, and a retained previous application for recovery.
- Added background Mac update preparation, a separate restart confirmation, and reuse of a prepared update after restarting the client.
- Added architecture-specific macOS ZIP archives and checksum files alongside the DMG installers.
- Fixed update detection for the canonical repository URLs returned by GitHub.
- Added 33 automated tests covering update dialogs, failed downloads, unsafe archives, bundle checks, installer failures and release artifacts.

## Installation and updates

- Windows x64: download `to-1.0.4-win32.exe`. Squirrel installations on 1.0.2/1.0.3 can receive the update through the existing update feed; those older versions retain their previous restart behavior until 1.0.4 is installed.
- macOS Intel: download `to-1.0.4-darwin-x64.dmg`.
- macOS Apple Silicon: download `to-1.0.4-darwin-arm64.dmg`.
- macOS now requires **macOS 13 Ventura or later**. Builds remain unsigned and unnotarized. Install the app outside the mounted DMG into a writable application directory.
- Mac versions older than 1.0.4 need one manual update. Subsequent versions can use the new Mac updater when the matching ZIP and SHA-256 assets are published.
- The updater does not disable Gatekeeper or remove quarantine attributes. A full application launch/update cycle on real Mac hardware has not yet been verified; Apple-specific OS commands are substituted in the cross-platform tests.
