import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API is proxied, so a phone only needs to reach this one address (port 5173).
// host: true listens on the local network; allowedHosts lets tunnel addresses such as *.trycloudflare.com work.
const proxy = { '/api': 'http://localhost:5001', '/uploads': 'http://localhost:5001' };

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, allowedHosts: true, proxy },
  preview: { host: true, port: 5173, allowedHosts: true, proxy },
});
