import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, generationHarness, harnessStartsAt, sourceWith, type GenerationHarness } from '../testing/index.ts';

const day = 86_400_000;

function assetIdOf(index: number): string {
  return `019a4f2e-0000-7000-8000-${String(index).padStart(12, '0')}`;
}

function runIdOf(index: number): string {
  return `019a4f2e-5c1b-7d3a-8e6f-${String(index).padStart(12, '0')}`;
}

async function twoOfTheSameBytes(): Promise<GenerationHarness> {
  const made = { count: 0 };
  const playbook = generationHarness({
    newAssetId: () => {
      made.count += 1;
      return assetIdOf(made.count);
    },
  });
  await playbook.define('short', sourceWith(['produces: image', 'model: gateway/openai/gpt-image-1', 'expires: P1D']));
  await playbook.define('long', sourceWith(['produces: image', 'model: gateway/openai/gpt-image-1', 'expires: P3D']));
  await playbook.run('short', {}, runIdOf(1));
  await playbook.run('long', {}, runIdOf(2));
  return playbook;
}

async function contentOf(playbook: GenerationHarness, id: string): Promise<boolean> {
  const row = await playbook.rowOf(id);
  return (await Effect.runPromise(playbook.ledger.service.content.get(alpha, String(row?.sha256)))) !== undefined;
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

  it('records each expiry, takes the asset from the totals and removes no content, which other holders may share', async () => {
    const playbook = await twoOfTheSameBytes();

    await playbook.expireAt(harnessStartsAt + day);
    const afterTheFirst = [await contentOf(playbook, assetIdOf(1)), await playbook.totals()];
    await playbook.expireAt(harnessStartsAt + 3 * day);

    expect(afterTheFirst).toEqual([true, { bytes: 70, assets: 1 }]);
    expect(await contentOf(playbook, assetIdOf(2))).toBe(true);
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
    expect(
      (await playbook.factsOf(assetIdOf(1))).map(({ type, data, context }) => ({
        type,
        data,
        at: context.at,
        by: context.by,
      })),
    ).toEqual([
      expect.objectContaining({ type: 'asset_kept' }),
      {
        type: 'asset_expired',
        data: { bytes: 70, content_removed: false },
        at: new Date(harnessStartsAt + day).toISOString(),
        by: 'runtime',
      },
    ]);
    expect((await playbook.factsOf(assetIdOf(2)))[1]?.data).toEqual({ bytes: 70, content_removed: false });
    expect(await playbook.rowOf(assetIdOf(2))).toMatchObject({ live: false, expires_at: null });
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
    expect(await playbook.totals()).toEqual({ bytes: 70, assets: 1 });
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
});
