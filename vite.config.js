import { defineConfig } from 'vite';
import { pwaPlugin } from './scripts/pwa.js';

export default defineConfig({
    base: '/wizard-shootout/',
    plugins: [pwaPlugin()],
    build: {
        outDir: 'dist',
    },
    server: {
        port: 3000,
        open: true,
    },
});
