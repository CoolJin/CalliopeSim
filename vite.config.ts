import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/CalliopeSim/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['web-tree-sitter']
  }
})
