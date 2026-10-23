import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { sandboxAnswers } from './sandbox-probes.ts';

describe('the answers of the sandbox to probes', () => {
  it('answers each expression as JSON, or names how it ended', async () => {
    expect(await sandboxAnswers(shippedFilesOnDisk, ['typeof eval', 'Date.now()', 'null.x', '0 / 0'])).toEqual([
      '"undefined"',
      '0',
      "raised: TypeError: cannot read property 'x' of null",
      'unfit: The answer holds NaN at $, which JSON cannot carry',
    ]);
  });
});
