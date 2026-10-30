import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    // A8: las pruebas de integración lanzan decenas de procesos git cada una. Con 11 archivos a la vez (lo de
    // fábrica en 12 núcleos) se ahogaban entre sí y vencían las esperas; con 4 la suite tarda lo mismo (~2 min)
    // y los beforeAll que arman repos tienen el mismo margen que las pruebas
    maxWorkers: 4,
    hookTimeout: 60_000
  }
})
