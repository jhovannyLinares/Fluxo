import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Spike S1: mide carga del grafo en repo de 100k commits. Lento: correr con `npm run bench`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['tests/perf/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000
  }
})
