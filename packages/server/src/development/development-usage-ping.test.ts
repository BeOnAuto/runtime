import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stoppedWith } from '../testing/processes/development-endings.ts';
import { developmentFiles, startDevelopment, untilListening } from '../testing/processes/development-process.ts';
import { pingsRecordedInto } from '../testing/records/recorded-pings.ts';

describe('the usage ping under pnpm dev', () => {
  it('is never sent, at the first start or after a save, even where the environment and .env turn it on', async () => {
    const files = developmentFiles();
    writeFileSync(files.localEnvFile, 'USAGE_PING=true\n');
    const pings = pingsRecordedInto(files.directory);
    const development = startDevelopment(files, { environment: { ...pings.settings, USAGE_PING: 'true' } });

    await untilListening(development);
    writeFileSync(join(files.sourceDirectory, 'saved.ts'), 'export const saved = true;\n');
    await untilListening(development, 2);
    await stoppedWith(development, 'SIGTERM');

    expect(pings.urls()).toEqual([]);
    expect(existsSync(join(files.directory, 'install-id'))).toBe(false);
    expect(development.stdout()).not.toContain('usage ping');
  });
});
