import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { pwaPlugin } from './scripts/pwa.js';

// Holiday W-22: the build's short version, shown in the menu footer so a
// phone can tell which deploy it runs. The deploy's commit (GITHUB_SHA in
// Actions), else the local checkout's; 'dev' on the dev server.
function buildVersion(command) {
    if (command === 'serve') return 'dev';
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
    try {
        return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown';
    } catch {
        return 'unknown';
    }
}

export default defineConfig(({ command }) => ({
    base: '/wizard-shootout/',
    plugins: [pwaPlugin()],
    define: {
        __BUILD__: JSON.stringify(buildVersion(command)),
    },
    build: {
        outDir: 'dist',
    },
    server: {
        port: 3000,
        open: true,
    },
}));
