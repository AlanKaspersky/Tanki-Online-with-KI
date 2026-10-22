## What's Changed

- Fixed KI extension updates getting stuck when a local or keyless copy was present. The official Chrome Web Store copy now takes priority.
- Preserve the extension's registered key after downloading so subsequent launches keep checking for updates. Existing local copies are preserved but are no longer selected over the store copy.
- Download and validate extension updates in a separate staging directory before replacement; restore the previous copy if installation fails. A failed update check still allows an installed store copy to load.
- Added nine extension-startup regression tests (68 automated tests in total).

Installed Windows clients receive this release through the existing automatic updater. Restart when prompted to apply it; the next launch checks KI against Chrome Web Store. This release updates the client, independently of the extension's store version.
