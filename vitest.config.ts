import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    // Env-gated integration tests share one live Neo4j database and perform
    // full-project reconciliation there, so test files must not run in
    // parallel or their writes would be interpreted as graph drift.
    fileParallelism: false,
  },
});