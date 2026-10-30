import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { describe, expect, it, onTestFinished } from 'vitest';

import { isServerSource, sourcesOf, watchSources, type SourceChanges } from './source-changes.ts';

function emptyDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-sources-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

async function reportedOnceWatching(changes: SourceChanges, save: () => void): Promise<string> {
  save();
  const reported = await Promise.race([changes.next(), setTimeout(500, 'not yet')]);
  return reported === 'not yet' ? reportedOnceWatching(changes, save) : reported;
}

describe('the sources that restart the server', () => {
  it.each([
    ['composition-root.ts', true],
    ['development/children.ts', true],
    ['development/children.test.ts', false],
    ['README.md', false],
  ])('counts %s as server source: %s', (file, counted) => {
    expect(isServerSource(file)).toBe(counted);
  });

  it('reports a TypeScript file saved anywhere under a source directory', async () => {
    const directory = emptyDirectory();
    mkdirSync(join(directory, 'nested'));
    const changes = watchSources(sourcesOf([directory], []));
    onTestFinished(changes.close);

    const reported = reportedOnceWatching(changes, () => {
      writeFileSync(join(directory, 'nested', 'saved.ts'), 'export const saved = true;\n');
    });

    await expect(reported).resolves.toBe(join(directory, 'nested', 'saved.ts'));
  });

  it('reports an env file saved, and nothing else beside it', async () => {
    const directory = emptyDirectory();
    const envFile = join(directory, 'dev.env');
    const changes = watchSources(sourcesOf([], [envFile]));
    onTestFinished(changes.close);

    const reported = reportedOnceWatching(changes, () => {
      writeFileSync(join(directory, 'other.ts'), 'export const other = true;\n');
      writeFileSync(envFile, 'LOG_FORMAT=pretty\n');
    });

    await expect(reported).resolves.toBe(envFile);
  });
});
