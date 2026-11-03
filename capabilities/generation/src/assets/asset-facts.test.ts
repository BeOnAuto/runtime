import { textToKeep } from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { contentHoldersOf, streamPrefixOfPlaybook } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { assetDecider } from './asset-decider.ts';
import { AssetEventSchema, assetStreamOf, type AssetEvent } from './asset-facts.ts';

const sha256 = 'c1f5e9a7d3b2a8f4e6c0d9b7a5f3e1c2d4b6a8f0e2c4d6b8a0f2e4c6d8b0a2f4';

const kept: AssetEvent = {
  type: 'asset_kept',
  data: {
    media_type: 'image/png',
    bytes: 182_044,
    sha256,
    kind: 'image',
    model: 'gateway/openai/gpt-image-2',
    prompt: 'A studio photograph of a teapot on a white table.',
    parameters: { size: '1024x1024', quality: 'high' },
    references: [{ id: '019a4f2e-0000-7000-8000-000000000001', sha256 }],
    cost_usd: 0.042,
    own_key: true,
    expires_at: '2027-01-30T10:00:00.000Z',
  },
  context: {
    at: '2026-11-01T10:00:00.000Z',
    by: 'key_7f3a',
    runId: '019a4f2e-5c1b-7d3a-8e6f-1a2b3c4d5e6f',
    definitionType: 'generation',
    definitionName: 'product-photo',
    definitionVersion: 3,
  },
};

const expired: AssetEvent = {
  type: 'asset_expired',
  data: { bytes: 182_044 },
  context: { at: '2027-01-30T10:00:05.000Z', by: 'runtime' },
};

const removed: AssetEvent = {
  type: 'asset_content_removed',
  data: { bytes: 182_044, sha256 },
  context: { at: '2027-01-30T10:00:05.000Z', by: 'runtime' },
};

describe('the facts of an asset', () => {
  recordedFactsBehaviour({
    schema: AssetEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.56.0': [kept, expired, removed] },
  });
});

describe('the stream of an asset', () => {
  it('records that it is kept once, that it expired once after, and that its content was removed once after that, and refuses each out of turn', () => {
    const keeping = { event: { type: kept.type, data: kept.data }, context: kept.context };
    const expiring = { event: { type: expired.type, data: expired.data }, context: expired.context };
    const removing = { event: { type: removed.type, data: removed.data }, context: removed.context };

    expect([
      Result.isSuccess(assetDecider.decide(keeping, 'none')),
      Result.isSuccess(assetDecider.decide(expiring, 'kept')),
      Result.isSuccess(assetDecider.decide(removing, 'expired')),
      Result.isFailure(assetDecider.decide(expiring, 'none')),
      Result.isFailure(assetDecider.decide(keeping, 'kept')),
      Result.isFailure(assetDecider.decide(expiring, 'expired')),
      Result.isFailure(assetDecider.decide(removing, 'kept')),
      Result.isFailure(assetDecider.decide(removing, 'removed')),
    ]).toEqual([true, true, true, true, true, true, true, true]);
    expect([
      assetDecider.evolve('none', kept),
      assetDecider.evolve('kept', expired),
      assetDecider.evolve('expired', removed),
    ]).toEqual(['kept', 'expired', 'removed']);
    expect(assetDecider.context(keeping, 'none')).toBe(kept.context);
  });
});

describe('the content of an asset', () => {
  it('is held by its asset from the fact that keeps it until the fact that it expired, and removed after that once its hour has passed', async () => {
    const { service: ledger } = memoryLedger(undefined, [], contentHoldersOf([AssetEventSchema]));
    const playbook = { org: 'acme', playbook: 'alpha' };
    const keptAt = Date.parse(kept.context.at);
    const pastItsHour = keptAt + 2 * 3_600_000;
    const content = await at(keptAt, ledger.content.put(playbook, textToKeep('the bytes of an image', 'image/png')));
    const stream = `${streamPrefixOfPlaybook(playbook)}${assetStreamOf('019a4f2e-0000-7000-8000-000000000002')}`;
    const keeping = {
      event: { type: kept.type, data: { ...kept.data, sha256: content.sha256 } },
      context: kept.context,
    };
    const expiring = { event: { type: expired.type, data: expired.data }, context: expired.context };

    await Effect.runPromise(ledger.execute(stream, assetDecider, keeping));
    const whileKept = await at(pastItsHour, ledger.removeUnheld(playbook, content.sha256));
    await Effect.runPromise(ledger.execute(stream, assetDecider, expiring));
    const onceExpired = await at(pastItsHour, ledger.removeUnheld(playbook, content.sha256));

    expect([whileKept, onceExpired]).toEqual(['held', 'removed']);
  });
});
