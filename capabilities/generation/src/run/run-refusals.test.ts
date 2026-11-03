import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import { numberedHarness, outcomeOfRun, ran, refusalOf, runIdOf } from '../run-testing/run-outcomes.ts';
import { answeredWith, imageSource, onePixelPng, sourceWith } from '../testing/index.ts';

const moderated = {
  reason: 'conflict',
  kind: 'blocked_by_moderation',
  detail:
    'The provider behind the gateway gateway refused the request under its moderation; change the prompt, the input or the references',
};

describe('the bytes a run may keep of one asset', () => {
  it('refuses an asset larger than the runtime keeps of its kind, keeps nothing of it, and records what the gateway answered it cost', async () => {
    const playbook = numberedHarness({
      bounds: { ...generationBounds, mostBytes: { ...generationBounds.mostBytes, image: 16 } },
    });
    await playbook.define('picture', imageSource);

    const outcome = await ran(playbook, 'picture', { product: 'a teapot' });

    expect(refusalOf(outcome)).toEqual({
      reason: 'conflict',
      kind: 'oversized',
      detail: 'The image the model made is larger than the 16 bytes this runtime keeps of one image',
    });
    expect(outcomeOfRun(await playbook.runOf(runIdOf(1)))).toEqual({
      status: 'rejected',
      record: { model: 'gateway/openai/gpt-image-2', own_key: true, cost_usd: 0.04 },
    });
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
  });
});

describe('the bytes a playbook may keep of assets', () => {
  it('is a soft bound, which the asset of a run that started below it takes past it, the next run refused before it asks', async () => {
    const most = onePixelPng.byteLength + 10;
    const playbook = numberedHarness({ bounds: { ...generationBounds, mostPlaybookBytes: most } });
    await playbook.define('picture', imageSource);
    await ran(playbook, 'picture', { product: 'a teapot' }, 1);

    const past = await ran(playbook, 'picture', { product: 'a kettle' }, 2);
    const refused = await ran(playbook, 'picture', { product: 'a mug' }, 3);

    expect(past.status).toBe('succeeded');
    expect(await playbook.totals()).toEqual({ bytes: 2 * onePixelPng.byteLength, assets: 2 });
    expect(refusalOf(refused)).toEqual({
      reason: 'conflict',
      kind: 'oversized',
      detail: `The playbook keeps ${2 * onePixelPng.byteLength} bytes of assets, and may keep ${most} bytes; an asset makes room as it expires`,
    });
    expect(playbook.gateway.asked()).toHaveLength(2);
  });

  it('asks nothing of the gateway once the playbook keeps all it may', async () => {
    const full = numberedHarness({ bounds: { ...generationBounds, mostPlaybookBytes: onePixelPng.byteLength } });
    await full.define('picture', imageSource);
    await ran(full, 'picture', { product: 'a teapot' }, 1);

    const atTheMost = await ran(full, 'picture', { product: 'a kettle' }, 2);

    expect(refusalOf(atTheMost)).toEqual({
      reason: 'conflict',
      kind: 'oversized',
      detail: `The playbook keeps ${onePixelPng.byteLength} bytes of assets, and may keep ${onePixelPng.byteLength} bytes; an asset makes room as it expires`,
    });
    expect(full.gateway.asked()).toHaveLength(1);
  });
});

describe('a run the provider refuses under its moderation', () => {
  it('is a conflict blocked by moderation, which keeps no asset and records no cost', async () => {
    const playbook = numberedHarness({
      answering: answeredWith(400, { error: { code: 'moderation_blocked', message: 'refused' } }),
    });
    await playbook.define('picture', imageSource);

    const outcome = await ran(playbook, 'picture', { product: 'a teapot' });

    expect(refusalOf(outcome)).toEqual(moderated);
    expect(outcomeOfRun(await playbook.runOf(runIdOf(1)))).toEqual({ status: 'rejected', record: undefined });
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
  });
});

describe('a run whose model or input the runtime cannot take', () => {
  it('is unavailable where the model names a gateway the runtime is not given', async () => {
    const elsewhere = numberedHarness();
    const none = numberedHarness({ gateways: [] });
    await elsewhere.define('picture', sourceWith(['produces: image', 'model: elsewhere/openai/gpt-image-2']));
    await none.define('picture', imageSource);

    expect([
      refusalOf(await ran(elsewhere, 'picture', {})),
      refusalOf(await ran(none, 'picture', { product: 'x' })),
    ]).toEqual([
      {
        reason: 'unavailable',
        kind: 'model_not_offered',
        detail: 'There is no model gateway named elsewhere: its gateways are gateway',
      },
      {
        reason: 'unavailable',
        kind: 'model_not_offered',
        detail: 'There is no model gateway named gateway: this runtime is given no model gateway',
      },
    ]);
  });

  it('refuses an input that is no object, or that its schema does not take', async () => {
    const playbook = numberedHarness();
    await playbook.define('picture', imageSource);

    const notAnObject = refusalOf(await ran(playbook, 'picture', 'a teapot', 1));
    const lacking = refusalOf(await ran(playbook, 'picture', {}, 2));

    expect(notAnObject).toEqual({
      reason: 'invalid_input',
      kind: 'input_schema',
      detail: 'The input of a generation function definition is a JSON object',
    });
    expect([lacking.reason, lacking.kind, lacking.detail.includes('product')]).toEqual([
      'invalid_input',
      'input_schema',
      true,
    ]);
  });
});
