import { Buffer } from 'node:buffer';

import { at } from '@on.auto/content/testing';
import {
  Conflict,
  PlaybookContext,
  PlaybookWriter,
  playbookLedgerOf,
  type AssetReference,
  type ValueKeeping,
} from '@on.auto/operations';
import { Context, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds, type GenerationBounds } from '../capability/generation-ports.ts';
import { day } from '../run-testing/run-outcomes.ts';
import { alpha, generationHarness, harnessStartsAt, type GenerationHarness } from '../testing/index.ts';
import { assetIdOfAValue, valuesKeptAsAssets } from './kept-values.ts';

type ValueToKeep = Parameters<ValueKeeping['kept']>[1];

const run = {
  context: {
    by: 'acme-admin',
    runId: '019a5b12-3d4e-7a5f-8b6c-9d0e1f2a3b4d',
    definitionType: 'computation',
    definitionName: 'the-export',
    definitionVersion: 3,
  },
  lineage: { causationId: 'start-1', correlationId: '019a5b12-3d4e-7a5f-8b6c-9d0e1f2a3b4d' },
};

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const page: ValueToKeep = {
  pointer: '/page',
  text: '# The reference\n\nEvery operation, its input and its answer.',
  mediaType: 'text/markdown; charset=utf-8',
};

const rows: ValueToKeep = { pointer: '', text: '[{"sku":"A-1","count":3}]', mediaType: 'application/json' };

function writerOf(playbook: GenerationHarness): PlaybookWriter['Service'] {
  return Context.get(playbookLedgerOf(playbook.ledger.service, alpha), PlaybookWriter);
}

function keptIn(
  playbook: GenerationHarness,
  value: ValueToKeep,
  bounds: GenerationBounds = generationBounds,
  writer = writerOf(playbook),
) {
  return at(
    harnessStartsAt,
    Effect.exit(
      valuesKeptAsAssets(bounds)
        .kept(run, value)
        .pipe(
          Effect.provideService(PlaybookWriter, writer),
          Effect.provide(playbookLedgerOf(playbook.ledger.service, alpha)),
          Effect.provideService(PlaybookContext, alpha),
        ),
    ),
  );
}

async function keptAs(playbook: GenerationHarness, value: ValueToKeep): Promise<AssetReference> {
  const kept = await keptIn(playbook, value);
  if (Exit.isFailure(kept)) {
    throw new Error('The value was not kept');
  }
  return kept.value;
}

describe('a value a run returned, kept as an asset of its playbook', () => {
  it('is kept as text made by the output of the run at its place, for as long as the playbook keeps an asset, under an id of the run, the place and the bytes', async () => {
    const playbook = generationHarness();

    const kept = await keptAs(playbook, page);

    expect(kept).toEqual({
      id: assetIdOfAValue(run.context.runId, '/page', kept.sha256),
      media_type: page.mediaType,
      bytes: Buffer.byteLength(page.text),
      sha256: aDigest,
      address: null,
      address_until: null,
    });
    expect(await playbook.factsOf(kept.id)).toMatchObject([
      {
        type: 'asset_kept',
        data: {
          kind: 'text',
          made_by: { function_output: { pointer: '/page' } },
          expires_at: new Date(harnessStartsAt + generationBounds.keptMs).toISOString(),
        },
        context: { ...run.context, at: new Date(harnessStartsAt).toISOString() },
      },
    ]);
    expect(await playbook.rowOf(kept.id)).toMatchObject({ kind: 'text', model: null, run: run.context.runId });
    expect(await playbook.totals()).toEqual({ bytes: kept.bytes, assets: 1 });
  });

  it('is the same asset when the same run keeps the same bytes at the same place again, as an attempt after a crash does', async () => {
    const playbook = generationHarness();

    const first = await keptAs(playbook, page);
    const again = await keptAs(playbook, page);
    const otherBytes = await keptAs(playbook, { ...page, text: `${page.text}\n` });
    const otherPlace = await keptAs(playbook, { ...page, pointer: '/copy' });

    expect(again).toEqual(first);
    expect(await playbook.factsOf(first.id)).toHaveLength(1);
    expect(new Set([first.id, otherBytes.id, otherPlace.id]).size).toBe(3);
  });
});

describe('a value a run returned whose bytes the playbook keeps already', () => {
  it('is kept under its own media type where the playbook keeps the same bytes under another', async () => {
    const playbook = generationHarness();
    const asText = { pointer: '/export', text: rows.text, mediaType: 'text/plain; charset=utf-8' };

    const json = await keptAs(playbook, rows);
    const text = await keptAs(playbook, asText);

    expect(text).toMatchObject({ media_type: asText.mediaType, sha256: json.sha256 });
    expect(await playbook.factsOf(text.id)).toMatchObject([{ data: { media_type: asText.mediaType } }]);
    expect(await playbook.rowOf(text.id)).toMatchObject({ media_type: asText.mediaType });
    expect(await playbook.assetOf(text.id)).toMatchObject({ output: { media_type: asText.mediaType } });
  });
});

describe('a value a run returned that is not kept', () => {
  it('is kept whole as JSON where the output was a list or an object', async () => {
    const playbook = generationHarness();

    const kept = await keptAs(playbook, rows);

    expect(await playbook.factsOf(kept.id)).toMatchObject([
      { data: { media_type: 'application/json', kind: 'text', made_by: { function_output: { pointer: '' } } } },
    ]);
  });

  it('is refused as too large, keeping nothing, past what the playbook keeps of one file or once its storage quota is reached', async () => {
    const playbook = generationHarness();
    const oneFileOfFewBytes = { ...generationBounds, mostFileBytes: 16 };
    const quotaReached = { ...generationBounds, mostPlaybookBytes: 1 };

    const tooLarge = await keptIn(playbook, page, oneFileOfFewBytes);
    const wholeTooLarge = await keptIn(playbook, rows, oneFileOfFewBytes);
    const first = await keptAs(playbook, rows);
    const full = await keptIn(playbook, page, quotaReached);

    expect([tooLarge, wholeTooLarge, full]).toEqual([
      Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'oversized' })),
      Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'oversized' })),
      Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'oversized' })),
    ]);
    expect(await playbook.totals()).toEqual({ bytes: first.bytes, assets: 1 });
  });

  it('ends with the refusal of the ledger that would record it, such as a store that keeps all it may', async () => {
    const playbook = generationHarness();
    const refusal = new Conflict({ detail: 'The store keeps all it may', kind: 'oversized' });
    const refusing = { ...writerOf(playbook), execute: () => Effect.fail(refusal) };

    expect(await keptIn(playbook, page, generationBounds, refusing)).toEqual(Exit.fail(refusal));
  });
});

describe('every reader of the assets of a playbook', () => {
  it('reads a kept value as it reads any asset: get_asset, and its expiry, which removes its content', async () => {
    const playbook = generationHarness();
    const kept = await keptAs(playbook, page);

    const read = await playbook.assetOf(kept.id);
    const expired = await playbook.expireAt(harnessStartsAt + generationBounds.keptMs + day);

    expect(read).toMatchObject({
      status: 'succeeded',
      output: { id: kept.id, media_type: page.mediaType, bytes: kept.bytes, sha256: kept.sha256, expired: false },
    });
    expect(expired).toBe(1);
    expect((await playbook.factsOf(kept.id)).map(({ type }) => type)).toEqual([
      'asset_kept',
      'asset_expired',
      'asset_content_removed',
    ]);
    expect(await Effect.runPromise(playbook.ledger.service.content.get(alpha, kept.sha256))).toBeUndefined();
  });
});
