import { textToKeep } from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { contentHoldersOf } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptAsRead } from '../run-testing/kept-as-read.ts';
import { assetDecider } from './asset-decider.ts';
import { AssetEventSchema, assetStreamOf, type AssetEvent } from './asset-facts.ts';

const sha256 = 'c1f5e9a7d3b2a8f4e6c0d9b7a5f3e1c2d4b6a8f0e2c4d6b8a0f2e4c6d8b0a2f4';

const kept = {
  type: 'asset_kept',
  data: {
    media_type: 'image/png',
    bytes: 182_044,
    sha256,
    kind: 'image',
    made_by: {
      generation: {
        model: 'gateway/openai/gpt-image-2',
        prompt: 'A studio photograph of a teapot on a white table.',
        parameters: { size: '1024x1024', quality: 'high' },
        references: [{ id: '019a4f2e-0000-7000-8000-000000000001', sha256 }],
        cost_usd: 0.042,
        own_key: true,
      },
    },
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
} satisfies AssetEvent;

const keptOfAToolCall: AssetEvent = {
  type: 'asset_kept',
  data: {
    media_type: 'image/png',
    bytes: 48_210,
    sha256: 'a3c9e1f7b5d2c8e4a6f0b9d7c5e3a1f2b4d6c8e0a2f4b6d8c0e2a4f6b8d0c2e4',
    kind: 'image',
    made_by: {
      tool_call: {
        call_id: 'toolu_01a7Hc3mWq2Xv9',
        server: 'browser',
        connection_id: '019a5b10-7e2c-7f41-9a3d-5c8e2b6f1d07',
        tool: 'browser_take_screenshot',
      },
    },
    expires_at: '2027-02-03T09:30:00.000Z',
  },
  context: {
    at: '2026-11-05T09:30:00.000Z',
    by: 'user_2q8Vb7KxN4',
    runId: '019a5b12-3d4e-7a5f-8b6c-9d0e1f2a3b4c',
    definitionType: 'reasoning',
    definitionName: 'check-the-order',
    definitionVersion: 2,
  },
};

const keptOfAFunctionOutput: AssetEvent = {
  type: 'asset_kept',
  data: {
    media_type: 'text/markdown; charset=utf-8',
    bytes: 3_355_443,
    sha256: 'e7b1d3f5a9c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a5c7e9b2d4f6a8c0e1b3',
    kind: 'text',
    made_by: { function_output: { pointer: '/page' } },
    expires_at: '2027-02-15T09:00:00.000Z',
  },
  context: {
    at: '2026-11-17T09:00:00.000Z',
    by: 'user_2q8Vb7KxN4',
    runId: '019a8f2e-6b1c-7d4a-9e3f-2a1b0c9d8e7f',
    definitionType: 'lookup',
    definitionName: 'fetch-the-reference',
    definitionVersion: 4,
  },
};

const keptWithNoExpiry: AssetEvent = {
  type: 'asset_kept',
  data: {
    media_type: 'image/png',
    bytes: 182_044,
    sha256,
    kind: 'image',
    made_by: {
      generation: {
        model: 'gateway/openai/gpt-image-2',
        prompt: 'A studio photograph of a teapot on a white table.',
        parameters: { size: '1024x1024' },
        references: [],
        own_key: true,
      },
    },
  },
  context: {
    at: '2026-11-20T10:00:00.000Z',
    by: 'key_7f3a',
    runId: '019aa0b1-2c3d-7e4f-8a5b-6c7d8e9f0a1b',
    definitionType: 'generation',
    definitionName: 'product-photo',
    definitionVersion: 4,
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
    releases: {
      '0.56.0': [kept, expired, removed],
      '0.57.0': [keptOfAToolCall],
      '0.64.0': [keptOfAFunctionOutput],
      '0.68.0': [keptWithNoExpiry],
    },
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

const ofTheRun = 'definition/acme/019a4f2e-0000-7000-8000-00000000d001/';

describe('the content of an asset', () => {
  it('is held by its asset from the fact that keeps it until the fact that it expired, and removed after that once its hour has passed', async () => {
    const { service: ledger } = memoryLedger(undefined, [], contentHoldersOf([AssetEventSchema]));
    const playbook = { org: 'acme', playbook: 'alpha' };
    const keptAt = Date.parse(kept.context.at);
    const pastItsHour = keptAt + 2 * 3_600_000;
    const content = await at(keptAt, ledger.content.put(playbook, textToKeep('the bytes of an image', 'image/png')));
    const stream = `${ofTheRun}${assetStreamOf('019a4f2e-0000-7000-8000-000000000002')}`;
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

const asJson = Schema.toCodecJson(AssetEventSchema);

const decodeJson = Schema.decodeUnknownResult(asJson);

const encodeJson = Schema.encodeSync(asJson);

const onTheRun = {
  at: '2026-11-20T09:00:00.000Z',
  by: 'user_2q8Vb7KxN4',
  runId: '019a5b12-3d4e-7a5f-8b6c-9d0e1f2a3b4d',
  definitionType: 'lookup',
  definitionName: 'fetch-the-reference',
  definitionVersion: 4,
};

const aPageARunReturned = {
  type: 'asset_kept',
  data: {
    media_type: 'text/markdown',
    bytes: 3_355_443,
    sha256,
    kind: 'text',
    made_by: { function_output: { pointer: '/page' } },
    expires_at: '2027-02-18T09:00:00.000Z',
  },
  context: onTheRun,
};

const aFileARunReturnedWhole = {
  ...aPageARunReturned,
  data: {
    ...aPageARunReturned.data,
    media_type: 'application/pdf',
    kind: 'file',
    made_by: { function_output: { pointer: '' } },
  },
};

describe('the kinds and the maker of an asset a later release writes, which this release reads first', () => {
  it('reads an asset of the kind text or file that a run returned at a place of its output, and writes it back as it read it', () => {
    const written: readonly unknown[] = [aPageARunReturned, aFileARunReturnedWhole];
    const read = written.map((fact: unknown) => Result.getOrThrow(decodeJson(fact)));

    expect(read).toEqual(written);
    expect(read.map((fact: AssetEvent) => encodeJson(fact))).toEqual(written);
    expect(read.map((fact: AssetEvent) => assetDecider.evolve('none', fact))).toEqual(['kept', 'kept']);
  });

  it('reads no kind and no maker beyond those, so a fact of one it does not know is not taken as an asset', () => {
    const unknownKind = { ...aPageARunReturned, data: { ...aPageARunReturned.data, kind: 'spreadsheet' } };
    const unknownMaker = { ...aPageARunReturned, data: { ...aPageARunReturned.data, made_by: { upload: {} } } };

    expect([Result.isFailure(decodeJson(unknownKind)), Result.isFailure(decodeJson(unknownMaker))]).toEqual([
      true,
      true,
    ]);
  });

  it('holds its content as an asset of any other kind does, from the fact that keeps it until the fact that it expired', async () => {
    const { service: ledger } = memoryLedger(undefined, [], contentHoldersOf([AssetEventSchema]));
    const playbook = { org: 'acme', playbook: 'alpha' };
    const keptAt = Date.parse(onTheRun.at);
    const pastItsHour = keptAt + 2 * 3_600_000;
    const content = await at(keptAt, ledger.content.put(playbook, textToKeep('# The reference', 'text/markdown')));
    const id = '019a5b12-0000-7000-8000-000000000003';
    const expiring = { event: { type: expired.type, data: expired.data }, context: expired.context };

    await at(
      keptAt,
      keptAsRead(ledger, {
        definitionKey: ofTheRun,
        id,
        data: { ...aPageARunReturned.data, kind: 'text', sha256: content.sha256 },
        context: onTheRun,
      }),
    );
    const whileKept = await at(pastItsHour, ledger.removeUnheld(playbook, content.sha256));
    await Effect.runPromise(ledger.execute(`${ofTheRun}${assetStreamOf(id)}`, assetDecider, expiring));
    const onceExpired = await at(pastItsHour, ledger.removeUnheld(playbook, content.sha256));

    expect([whileKept, onceExpired]).toEqual(['held', 'removed']);
  });
});
