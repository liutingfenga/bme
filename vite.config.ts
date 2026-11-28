import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BME',
      fileName: (format) => `bme.${format === 'es' ? 'esm' : 'cjs'}.js`,
    },
    rollupOptions: {
      // Dependencies to bundle
      external: ['dexie', 'zod'],
      output: [
        {
          format: 'es',
          entryFileNames: '[name].esm.js',
          dir: 'dist',
        },
        {
          format: 'cjs',
          entryFileNames: '[name].cjs.js',
          dir: 'dist',
        },
      ],
    },
    outDir: 'dist',
    sourcemap: true,
  },
})
