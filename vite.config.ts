import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 7653,
    proxy: {
      '/api': {
        target: 'http://localhost:7654',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://localhost:7654',
        changeOrigin: true,
      }
    }
  }
})