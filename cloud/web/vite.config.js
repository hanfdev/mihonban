import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0：IPv4 的 localhost / 127.0.0.1 / 局域网 IP 都能进（默认有时只绑 ::1）
    host: true,
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { chunkSizeWarningLimit: 1200 },
})
