import { contentOfBytes } from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assetIdOf, day, numberedHarness, runIdOf } from '../run-testing/run-outcomes.ts';
import { alpha, harnessStartsAt, onePixelPng, sourceWith, type GenerationHarness } from '../testing/index.ts';

const image = ['produces: image', 'model: gateway/openai/gpt-image-2'];

async function twoOfTheSameBytes(): Promise<GenerationHarness> {
  const playbook = numberedHarness();
  await playbook.define('short', sourceWith([...image, 'expires: P1D']));
  await playbook.define('long', sourceWith([...image, 'expires: P3D']));
  await playbook.run('short', {}, runIdOf(1));
  await playbook.run('long', {}, runIdOf(2));
  return playbook;
}

async function contentOf(playbook: GenerationHarness, id: string): Promise<boolean> {
  const row = await playbook.rowOf(id);
  return (await Effect.runPromise(playbook.ledger.service.content.get(alpha, String(row?.sha256)))) !== undefined;
}

interface FactSeen {
  readonly type: string;
  readonly data: unknown;
  readonly at: string;
  readonly by: string;
}

async function factsIn(playbook: GenerationHarness, id: string): Promise<readonly FactSeen[]> {
  return (await playbook.factsOf(id)).map(({ type, data, context }) => ({
    type,
    data,
    at: context.at,
    by: context.by,
  }));
}

async function typesIn(playbook: GenerationHarness, id: string): Promise<readonly string[]> {
  return (await playbook.factsOf(id)).map(({ type }) => type);
}

describe('the expiry of assets', () => {
  it('is due at the time each asset expires, in the lane of the work that calls nothing outside', async () => {
    const playbook = await twoOfTheSameBytes();

    expect(await Effect.runPromise(playbook.due.nextDueAt(harnessStartsAt))).toBe(harnessStartsAt + day);
    expect(await Effect.runPromise(playbook.due.nextDueAt(harnessStartsAt, true))).toBeNull();
    expect(await Effect.runPromise(playbook.due.due(harnessStartsAt + 3 * day, 10, true))).toEqual([]);
    expect(
      (await Effect.runPromise(playbook.due.due(harnessStartsAt + day, 10, false))).map(({ key, callsOut }) => ({
        key,
        callsOut,
      })),
    ).toEqual([{ key: `acme/alpha/${assetIdOf(1)}`, callsOut: false }]);
    expect(await playbook.expireAt(harnessStartsAt + day - 1)).toBe(0);
  });
});

describe('the expiry of an asset whose bytes another asset holds', () => {
  it('records each expiry and takes the asset from the totals, and keeps its content while another asset holds the same bytes', async () => {
    const playbook = await twoOfTheSameBytes();

    await playbook.expireAt(harnessStartsAt + day);

    expect([await contentOf(playbook, assetIdOf(1)), await playbook.totals()]).toEqual([
      true,
      { bytes: onePixelPng.byteLength, assets: 1 },
    ]);
    expect(await factsIn(playbook, assetIdOf(1))).toEqual([
      expect.objectContaining({ type: 'asset_kept' }),
      {
        type: 'asset_expired',
        data: { bytes: onePixelPng.byteLength },
        at: new Date(harnessStartsAt + day).toISOString(),
        by: 'runtime',
      },
    ]);
    expect(await playbook.rowOf(assetIdOf(1))).toMatchObject({ live: false, expires_at: null });
  });
});

describe('the expiry of the last asset that holds its bytes', () => {
  it('removes the content once the last asset that holds it expires, and records its removal on that asset', async () => {
    const playbook = await twoOfTheSameBytes();
    const sha256 = String((await playbook.rowOf(assetIdOf(2)))?.sha256);

    await playbook.expireAt(harnessStartsAt + day);
    await playbook.expireAt(harnessStartsAt + 3 * day);

    expect(await contentOf(playbook, assetIdOf(2))).toBe(false);
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
    expect((await factsIn(playbook, assetIdOf(2))).slice(1)).toEqual([
      {
        type: 'asset_expired',
        data: { bytes: onePixelPng.byteLength },
        at: new Date(harnessStartsAt + 3 * day).toISOString(),
        by: 'runtime',
      },
      {
        type: 'asset_content_removed',
        data: { bytes: onePixelPng.byteLength, sha256 },
        at: new Date(harnessStartsAt + 3 * day).toISOString(),
        by: 'runtime',
      },
    ]);
  });
});

describe('the expiry of an asset whose bytes were kept again lately', () => {
  it('keeps the content of an asset whose bytes were kept again within the hour before it expired, and records no removal', async () => {
    const playbook = numberedHarness();
    await playbook.define('short', sourceWith([...image, 'expires: P1D']));
    await playbook.run('short', {}, runIdOf(1));
    const keptAgainAt = harnessStartsAt + day - 600_000;
    await at(keptAgainAt, playbook.ledger.service.content.put(alpha, contentOfBytes(onePixelPng, 'image/png')));

    await playbook.expireAt(harnessStartsAt + day);

    expect(await contentOf(playbook, assetIdOf(1))).toBe(true);
    expect(await typesIn(playbook, assetIdOf(1))).toEqual(['asset_kept', 'asset_expired']);
  });
});

describe('an expiry performed more than once', () => {
  it('records an expiry once, though it is performed twice', async () => {
    const playbook = await twoOfTheSameBytes();
    const items = await Effect.runPromise(playbook.due.due(harnessStartsAt + day, 10, false));

    await Effect.runPromise(
      Effect.forEach([...items, ...items], (item) => item.perform(harnessStartsAt + day), { discard: true }),
    );

    expect(await playbook.factsOf(assetIdOf(1))).toHaveLength(2);
    expect(await playbook.totals()).toEqual({ bytes: onePixelPng.byteLength, assets: 1 });
  });

  it('records the expiry of one performer, and lets the one that comes second record nothing', async () => {
    const playbook = await twoOfTheSameBytes();
    const items = await Effect.runPromise(playbook.due.due(harnessStartsAt + day, 10, false));

    await Effect.runPromise(
      Effect.forEach([...items, ...items], (item) => item.perform(harnessStartsAt + day), {
        concurrency: 'unbounded',
        discard: true,
      }),
    );

    expect(await playbook.factsOf(assetIdOf(1))).toHaveLength(2);
  });

  it('records a removal once, though the content is found unheld by two performers of the last expiry', async () => {
    const playbook = numberedHarness();
    await playbook.define('short', sourceWith([...image, 'expires: P1D']));
    await playbook.run('short', {}, runIdOf(1));
    const items = await Effect.runPromise(playbook.due.due(harnessStartsAt + day, 10, false));

    await Effect.runPromise(
      Effect.forEach([...items, ...items], (item) => item.perform(harnessStartsAt + day), {
        concurrency: 'unbounded',
        discard: true,
      }),
    );

    expect(await typesIn(playbook, assetIdOf(1))).toEqual(['asset_kept', 'asset_expired', 'asset_content_removed']);
  });
});
