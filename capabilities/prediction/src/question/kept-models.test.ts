import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, builtFrom, savedFunction } from '../build-testing/built-versions.ts';

describe('a question to a version whose file the model processes no longer hold', () => {
  it('is answered from the file kept for the version', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await builtFrom(playbook, ['visits-mean']);
    rmSync(join(playbook.test.directory, 'models'), { recursive: true, force: true });

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      output: { status: 'succeeded', output: { lines: [{}, { points: [{ value: 11 }] }] } },
    });
  });
});
