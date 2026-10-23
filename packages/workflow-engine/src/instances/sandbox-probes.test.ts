import { describe, expect, it } from 'vitest';

import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { sandboxAnswers } from './sandbox-probes.ts';

describe.each(sourcesUnderTest)('the answers of the sandbox on the $name source to probes', ({ source }) => {
  it('answers each expression as JSON, or names how it ended', async () => {
    expect(await sandboxAnswers(source, ['typeof eval', 'Date.now()', 'null.x', '0 / 0'])).toEqual([
      '"undefined"',
      '0',
      "raised: TypeError: cannot read property 'x' of null",
      'unfit: The answer holds NaN at $, which JSON cannot carry',
    ]);
  });
});
