import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative output keeps one build portable across GitHub project Pages,
  // custom domains, and local static folders.
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    fs: {
      deny: [
        '**/cases/**',
        '**/.build/**',
        '**/.detective-data/**',
        '**/server/**',
      ],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
})
