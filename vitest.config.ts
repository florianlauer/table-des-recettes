import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    include: [
      'src/**/*.test.ts',
      'convex/**/*.test.ts',
      'spike/replay-fixtures.test.ts',
      'spike/compare-v3.test.ts',
    ],
  },
})
