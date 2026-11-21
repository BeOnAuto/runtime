import { basename, join } from 'node:path';

import { defineConfig, mergeConfig } from 'vitest/config';

const theFolderOfTheTestRun = join(import.meta.dirname, 'packages/operations/src/process-testing/test-run-folder.ts');

export function sharedConfigSetUpBy(globalSetup: string) {
  return defineConfig({
    test: {
      globalSetup,
      testTimeout: 60_000,
      hookTimeout: 60_000,
      silent: 'passed-only',
      experimental: {
        viteModuleRunner: false,
      },
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
        reporter: ['text-summary', ['text', { skipFull: true }], 'json-summary'],
        autoAttachSubprocess: true,
        thresholds: { 100: true, perFile: true },
      },
    },
  });
}

/**
 * The packages whose test files still each start a process of their own: their tests spawn processes, keep warm
 * workers or wait on a real clock; in documents a test registers a resolve hook for the rest of its process and asserts
 * which build of a library it loaded, and in outbound a test asserts which modules its process has not loaded yet. One
 * file's leftovers could reach the next. Every other package runs its files one after another in a process per worker,
 * since a fresh process per file spent most of the package's time loading the same modules again. The server sets itself up by `sharedConfigSetUpBy`, and stays isolated too.
 */
const ISOLATED = new Set([
  'computation',
  'documents',
  'ledger',
  'outbound',
  'tool-servers',
  'workflow-engine',
  'workflow-host',
]);

/** The package vitest runs in, whose folder it starts from. */
const thePackage = basename(process.cwd());

export const sharedConfig = mergeConfig(
  sharedConfigSetUpBy(theFolderOfTheTestRun),
  defineConfig({ test: { isolate: ISOLATED.has(thePackage) } }),
);
