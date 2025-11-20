import { defineConfig } from 'vite';


export default defineConfig({
  base: './',
  plugins: [],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: { manualChunks: undefined },
    },
  },
});

