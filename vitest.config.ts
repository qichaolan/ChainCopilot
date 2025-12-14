import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', '.venv'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Focus coverage on pure library code that can be unit tested
      include: [
        'lib/utils.ts',
        'lib/types/**/*.ts',
        'lib/heatmap/**/*.ts',
      ],
      exclude: [
        'node_modules',
        '.next',
        '**/*.test.ts',
        '**/*.d.ts',
        // Exclude API routes - require integration testing with Next.js
        'app/api/**/*.ts',
        // Exclude services that depend on external APIs
        'services/**/*.ts',
        // Exclude AI module - requires external API
        'lib/ai/**/*.ts',
        // Exclude OpenBB TS module - placeholder code, actual impl is Python
        'lib/openbb/index.ts',
      ],
      thresholds: {
        lines: 95,
        branches: 85, // Branch coverage is harder to achieve
        functions: 95,
        statements: 95,
      },
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
