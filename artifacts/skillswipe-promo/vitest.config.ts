import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Deliberately separate from Vite's app config: no services, secrets, or
// workspace preview plugins are needed to exercise playback controls.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['tests/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
