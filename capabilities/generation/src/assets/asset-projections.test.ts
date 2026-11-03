import { checkedProjection, type ProjectedMessage } from '@on.auto/operations';
import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { assetPresenter } from './asset-presenter.ts';
import { assets, assetTotals, totalsRowOf } from './asset-projections.ts';
import { sizeInWords } from './asset-words.ts';

const sha256 = 'c1f5e9a7d3b2a8f4e6c0d9b7a5f3e1c2d4b6a8f0e2c4d6b8a0f2e4c6d8b0a2f4';

const keptData = {
  media_type: 'audio/mpeg',
  bytes: 2048,
  sha256,
  kind: 'audio',
  model: 'gateway/openai/tts-1',
  prompt: 'Welcome',
  parameters: { voice: 'alloy', format: 'mp3' },
  references: [],
  own_key: false,
  expires_at: '2026-12-01T10:00:00.000Z',
};

const onTheRun = {
  at: '2026-11-01T10:00:00.000Z',
  by: 'key_7f3a',
  runId: 'run-1',
  definitionType: 'generation',
  definitionName: 'welcome',
  definitionVersion: 1,
};

function message(type: string, data: unknown, context: ProjectedMessage['context']): ProjectedMessage {
  return { id: `id-${type}`, position: 1, type, data, context };
}

const keptMessage = message('asset_kept', keptData, onTheRun);

const expiredMessage = message('asset_expired', { bytes: 2048 }, { at: '2026-12-01T10:00:05.000Z', by: 'runtime' });

const otherMessage = message('run_started', {}, onTheRun);

describe('the projection of the assets of a playbook', () => {
  it('is a projection the ledger takes', () => {
    expect([checkedProjection(assets).name, checkedProjection(assetTotals).name]).toEqual(['assets', 'asset_totals']);
  });

  it('keeps a row of each asset from its fact, which leaves the expiring index once the asset expired', () => {
    const kept = assets.rowAfter(undefined, keptMessage);

    expect(kept).toEqual({
      media_type: 'audio/mpeg',
      bytes: 2048,
      sha256,
      kind: 'audio',
      model: 'gateway/openai/tts-1',
      run: 'run-1',
      kept_at: Date.parse('2026-11-01T10:00:00.000Z'),
      expires_at: Date.parse('2026-12-01T10:00:00.000Z'),
      expired_at: null,
      live: true,
    });
    expect(assets.rowAfter(kept, expiredMessage)).toMatchObject({
      expires_at: null,
      expired_at: Date.parse('2026-12-01T10:00:05.000Z'),
      live: false,
    });
  });

  it('changes no row for a fact of no asset, nor for an expiry of an asset it holds no row of', () => {
    expect([
      assets.rowAfter(undefined, otherMessage),
      assets.rowAfter(undefined, expiredMessage),
      assets.rowAfter({ unreadable: true }, expiredMessage),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the projection of the bytes each playbook keeps of assets', () => {
  it('keeps the bytes and the count of the assets a playbook holds', () => {
    const one = assetTotals.rowAfter(undefined, keptMessage);
    const two = assetTotals.rowAfter(one, keptMessage);

    expect([one, two, assetTotals.rowAfter(two, expiredMessage), assetTotals.rowAfter(two, otherMessage)]).toEqual([
      { bytes: 2048, assets: 1 },
      { bytes: 4096, assets: 2 },
      { bytes: 2048, assets: 1 },
      undefined,
    ]);
    expect([assetTotals.keyOf?.(keptMessage, { kind: 'assets', id: 'a' }), totalsRowOf({ bytes: 'many' })]).toEqual([
      'playbook',
      { bytes: 0, assets: 0 },
    ]);
  });
});

function shown(type: string, data: unknown, context: ProjectedMessage['context']): string | undefined {
  return assetPresenter.present(
    {
      id: 'f',
      causationId: null,
      correlationId: null,
      stream: 'playbook/acme/alpha/assets/a',
      version: 1,
      globalPosition: 1,
      type,
      data,
      context,
      recordedAt: context.at,
    },
    nothingKept,
  )[0]?.summary;
}

describe('the facts of an asset as the feed shows them', () => {
  it('says what was kept and until when, that it expired, and that its content was removed once nothing else held it', () => {
    expect([
      shown('asset_kept', keptData, onTheRun),
      shown('asset_kept', { ...keptData, kind: 'image', bytes: 3_500_000 }, onTheRun),
      shown('asset_kept', { ...keptData, kind: 'video', bytes: 1 }, onTheRun),
      shown('asset_expired', { bytes: 2048 }, expiredMessage.context),
      shown('asset_content_removed', { bytes: 2048, sha256 }, expiredMessage.context),
    ]).toEqual([
      'The playbook kept audio of 2 KiB that a generation function made, until 2026-12-01.',
      'The playbook kept an image of 3.3 MiB that a generation function made, until 2026-12-01.',
      'The playbook kept a video of 1 byte that a generation function made, until 2026-12-01.',
      'An asset of 2 KiB expired.',
      'The content of an expired asset, 2 KiB, was removed, since nothing else of the playbook holds it.',
    ]);
  });

  it('words a size in bytes, KiB or MiB', () => {
    expect([sizeInWords(0), sizeInWords(1), sizeInWords(1023), sizeInWords(1536), sizeInWords(20 * 1_048_576)]).toEqual(
      ['0 bytes', '1 byte', '1,023 bytes', '1.5 KiB', '20 MiB'],
    );
  });
});
