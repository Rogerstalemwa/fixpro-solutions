import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API is proxied so the refresh-token cookie stays same-origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:5001', '/uploads': 'http://localhost:5001' } },
});
