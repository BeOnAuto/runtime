import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { endingOf, runningDevelopment } from '../testing/processes/development-endings.ts';
import { pidsOf, untilListening } from '../testing/processes/development-process.ts';

describe('saving a file under pnpm dev', () => {
  it('restarts the server once through its clean shutdown, and leaves nothing running when stopped', async () => {
    const development = await runningDevelopment();

    writeFileSync(join(development.files.sourceDirectory, 'saved.ts'), 'export const saved = true;\n');
    await untilListening(development, 2);
    development.signal('SIGTERM');

    await expect(endingOf(development)).resolves.toEqual({
      exitCode: 0,
      said: [`${join(development.files.sourceDirectory, 'saved.ts')} changed, so the server restarts`],
    });
    expect(pidsOf(development)).toHaveLength(2);
  });
});
