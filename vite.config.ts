import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { deskApi } from './scripts/desk-api.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

// Served from the custom domain fabriccreditratings.com, so assets load from the root.
// desk.html is dev-only: it is not a build input, so it never ships.
export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [react(), deskApi(root, loadEnv(mode, root, ''))],
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        rate: fileURLToPath(new URL('rate.html', import.meta.url)),
      },
    },
  },
}));
