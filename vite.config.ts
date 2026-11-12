import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // MapLibre (~1 MB) is only loaded lazily in step 02.
  build: { chunkSizeWarningLimit: 1100 },
});
