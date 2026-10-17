## What's Changed

- Added Windows taskbar alerts when a battle is found while the client is minimized or behind another application.
- Added background alerts when matchmaking stops, the game disconnects or removes you from a battle, or the game page fails or crashes.
- Alerts stop when you return focus to the game and never bring the client to the foreground automatically.
- Kept game rendering, loading and timers active in the background to address stale frames after restoring the window.
- Fixed Windows installer builds from folders containing Cyrillic or other non-ASCII characters.
- Expanded regression coverage to 59 tests and updated the documentation.
