import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BME',
      formats: ['umd'],
      fileName: () => 'bme.umd.js',
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
        // 将 dexie 和 zod 打包进去（UMD 自包含）
      },
    },
    outDir: 'dist',
  },
})
