import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'react-native': 'react-native-web',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/saved-deck-filters.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
