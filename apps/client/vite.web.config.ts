import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8791'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss(resolve(__dirname, 'tailwind.config.js')), autoprefixer()] } },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': {
        target: devApiTarget,
        changeOrigin: true
      },
      '/socket.io': {
        target: devApiTarget,
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true
  }
})
