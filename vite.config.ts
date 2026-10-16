import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from the custom domain fabriccreditratings.com, so assets load from the root.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    // FCR_API_TARGET points /api at a Functions host on another port. `||`, so an empty value falls back to 7071.
    proxy: { '/api': process.env.FCR_API_TARGET || 'http://localhost:7071' },
  },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        rate: fileURLToPath(new URL('rate.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
        about: fileURLToPath(new URL('about.html', import.meta.url)),
      },
    },
  },
});
