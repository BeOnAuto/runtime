import { join } from 'node:path';

import { defineConfig } from 'vitest/config';

const theFolderOfTheTestRun = join(import.meta.dirname, 'packages/operations/src/process-testing/test-run-folder.ts');

export function sharedConfigSetUpBy(globalSetup: string) {
  return defineConfig({
    test: {
      globalSetup,
      testTimeout: 60_000,
      hookTimeout: 60_000,
      experimental: {
        viteModuleRunner: false,
      },
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
        reporter: ['text', 'json-summary'],
        autoAttachSubprocess: true,
        thresholds: { 100: true, perFile: true },
      },
    },
  });
}

export const sharedConfig = sharedConfigSetUpBy(theFolderOfTheTestRun);
