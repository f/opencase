import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { createDemoHostVitePlugin } from './server/demo-host/vite-plugin'

const projectRoot = import.meta.dirname

export default defineConfig({
  plugins: [
    createDemoHostVitePlugin({
      casesDirectory: resolve(projectRoot, 'cases'),
      dataDirectory: resolve(projectRoot, '.detective-data'),
    }),
    react(),
  ],
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
