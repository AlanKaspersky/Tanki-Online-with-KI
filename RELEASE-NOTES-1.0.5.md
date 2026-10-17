## What's Changed

- Added complete ad-hoc signing for macOS app bundles and nested components without requiring an Apple Developer ID certificate.
- Made Mac packaging fail on signing errors and verify resource seals, application version and CPU architecture.
- Added an offline startup probe for the actual packaged application on matching-architecture build runners, including renderer isolation, JavaScript and WebGL/GPU reporting.
- Expanded the automated suite to 35 tests, including rejection of broken signatures, wrong architecture and failed native startup.
- Verified the update on the previously affected Apple Silicon Mac: the user confirmed that the reported problems are resolved.

## Installation and updates

- Windows: install to-1.0.5-win32.exe, or use the update offered by an installed client.
- Apple M-series Macs: install to-1.0.5-darwin-arm64.dmg (or the matching ZIP).
- Intel Macs: install to-1.0.5-darwin-x64.dmg (or the matching ZIP).
- This is the stable release. Compatible clients with the updater introduced in 1.0.4 can discover it through the stable update channel.
- Fully quit the previous client before replacing the app in Applications. If 1.0.4 is blocked as damaged, replace it manually. Mac clients older than 1.0.4 also need a manual upgrade.
- These builds are ad-hoc signed, not Developer ID signed or notarized. macOS may still require explicit approval in Privacy & Security.
