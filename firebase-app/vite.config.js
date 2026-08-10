import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite build output goes to `dist`, which Firebase Hosting serves (see firebase.json).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
