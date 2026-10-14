import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from the custom domain fabriccreditratings.com, so assets load from the root.
export default defineConfig(() => ({
  base: '/',
  plugins: [react()],
}));
