import { defineConfig } from 'vitest/config';
import path from 'path';

const apiNodeModules = path.resolve('./functions/api/node_modules');

export default defineConfig({
  resolve: {
    alias: {
      '@aws-sdk/client-ssm': path.join(apiNodeModules, '@aws-sdk/client-ssm'),
      '@aws-sdk/client-dynamodb': path.join(apiNodeModules, '@aws-sdk/client-dynamodb'),
      '@aws-sdk/lib-dynamodb': path.join(apiNodeModules, '@aws-sdk/lib-dynamodb'),
    },
  },
  test: {
    include: ['tests/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['scripts/utils.mjs', 'src/lib/**/*.mjs', 'functions/api/**/*.mjs'],
      exclude: ['src/lib/api.mjs', 'src/lib/favorites.mjs'],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
