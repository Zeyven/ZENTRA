import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()],
    server: {
      // React Refresh injects an inline preamble rejected by the desktop CSP.
      // Desktop development reloads explicitly; packaged builds have no HMR.
      hmr:false,
      host:'127.0.0.1',port:5176,strictPort:true,
      proxy: {
        '/api': 'http://127.0.0.1:8791',
        '/socket.io': {target:'http://127.0.0.1:8791',ws:true}
      }
    }
  }
})
