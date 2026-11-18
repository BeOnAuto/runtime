import { describe, expect, it } from 'vitest';

import { beta, generationHarness, imageSource } from './index.ts';

describe('the readers of the harness', () => {
  it('answer no facts of an asset the playbook does not hold, and the key of a function by its name in a playbook', async () => {
    const playbook = generationHarness();
    await playbook.define('picture', imageSource, beta);

    expect(await playbook.factsOf('019a4f2e-0000-7000-8000-000000000001')).toEqual([]);
    expect(await playbook.definitionKeyOf('picture', beta)).toMatch(/^definition\/acme\/[0-9a-f-]{36}\/$/u);
    await expect(playbook.definitionKeyOf('picture')).rejects.toThrow(
      'No generation function holds the name picture in the playbook alpha',
    );
  });
});
