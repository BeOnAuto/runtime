import { defineConfig, mergeConfig } from 'vitest/config';

import configuration from './vitest.config.ts';

const group = process.env['SERVER_TEST_GROUP'];
if (group === undefined || !['a-c', 'd-l', 'm-r', 's-z'].includes(group)) {
  throw new Error('SERVER_TEST_GROUP must name a configured test group');
}

export default mergeConfig(
  configuration,
  defineConfig({
    test: {
      include: [
        `src/[${group}]*/**/*.test.ts`,
        `src/[${group}]*.test.ts`,
        `npm/[${group}]*.test.ts`,
        `npm/[${group}]*/**/*.test.ts`,
        `[${group}]*.test.ts`,
      ],
      maxWorkers: Number(process.env['VITEST_MAX_WORKERS'] ?? 2),
      reporters: ['default', ['blob', { outputFile: `.vitest/groups/${group}/report.json` }]],
      coverage: {
        enabled: true,
        reportsDirectory: `.vitest/groups/${group}/coverage`,
        reporter: [],
        thresholds: { 100: false },
      },
    },
  }),
);
