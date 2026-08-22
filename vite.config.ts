import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/rollingCows/',
  build: {
    target: 'es2022',
    // 'hidden' genera la sourcemap ma toglie il commento sourceMappingURL dal
    // bundle: il file .map (2,3 MB, il 79% dell'artefatto) resta caricabile a
    // mano per un debug, ma smette di essere scaricato da chiunque apra il
    // pannello sviluppatore su Pages.
    sourcemap: 'hidden',
  },
  server: {
    host: true,
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
