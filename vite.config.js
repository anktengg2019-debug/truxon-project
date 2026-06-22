import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        driver: resolve(__dirname, 'driver.html'),
        login: resolve(__dirname, 'login.html'),
        signup: resolve(__dirname, 'signup.html'),
        booking: resolve(__dirname, 'booking.html'),
      },
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          leaflet: ['leaflet'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
