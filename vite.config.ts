import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/rollingCows/',
  build: {
    target: 'es2022',
    sourcemap: true,
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
