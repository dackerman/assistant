import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 7653,
    allowedHosts: ['homoiconicity', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: 'http://localhost:7654',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://localhost:7654',
        changeOrigin: true,
      },
    },
  },
});
