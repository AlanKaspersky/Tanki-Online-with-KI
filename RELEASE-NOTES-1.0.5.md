## What's Changed

- Added complete ad-hoc signing for macOS app bundles and nested components without requiring an Apple Developer ID certificate.
- Made Mac packaging fail on signing errors and verify resource seals, application version and CPU architecture.
- Added an offline startup probe for the actual packaged application on matching-architecture build runners, including renderer isolation, JavaScript and WebGL/GPU reporting.
- Expanded the automated suite to 35 tests, including rejection of broken signatures, wrong architecture and failed native startup.

## macOS installation

- Apple M-series Macs: install to-1.0.5-darwin-arm64.dmg (or the matching ZIP).
- Intel Macs: install to-1.0.5-darwin-x64.dmg (or the matching ZIP).
- Fully quit the previous client before replacing the app in Applications. If 1.0.4 is blocked as damaged, replace it manually.
- These builds are ad-hoc signed, not Developer ID signed or notarized. macOS may still require explicit approval in Privacy & Security.
- This patch addresses Mac packaging and startup validation. It does not claim a verified fix for in-game FPS, a 120 FPS cap, or Discord status on every Mac.
