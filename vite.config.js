import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        driver: resolve(__dirname, 'driver.html'),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
