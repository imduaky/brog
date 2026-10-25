import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = process.env.BROG_BACKEND ?? 'http://localhost:8080'

export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/web'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/images': backend,
      '/git': backend,
    },
  },
})
