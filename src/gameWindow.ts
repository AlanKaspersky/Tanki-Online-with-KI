import type { WebPreferences } from 'electron';

// Keep game frames, timers and loading transitions alive while minimized.
// This setting is independent of the process scheduling priority switch.
export function gameWebPreferences(preload: string): WebPreferences {
    return { preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false };
}
