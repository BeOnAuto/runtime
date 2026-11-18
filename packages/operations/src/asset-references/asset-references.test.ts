import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { AssetKeeper } from './asset-keeper.ts';
import {
  assetContentOf,
  assetReferenceOf,
  assetsIn,
  holdsAnAsset,
  isAssetShaped,
  type AssetReference,
} from './asset-references.ts';
import { assetUnusable, noAssetsHeld } from './held-assets.ts';

const asset: AssetReference = {
  id: '019a5b12-0000-7000-8000-000000000001',
  media_type: 'application/pdf',
  bytes: 3_355_443,
  sha256: 'a'.repeat(64),
  address: null,
  address_until: null,
};

describe('an asset in a step’s data', () => {
  it('is an object with exactly the members of an asset, whatever their order', () => {
    const reordered = Object.fromEntries(Object.entries(asset).toReversed());

    expect([isAssetShaped(asset), isAssetShaped(reordered), assetReferenceOf(reordered)]).toEqual([true, true, asset]);
  });

  it('is not an object with a member more or less, a list, or a value that is not an object', () => {
    const { address: _address, ...fewer } = asset;

    expect([
      isAssetShaped({ ...asset, name: 'report.pdf' }),
      isAssetShaped(fewer),
      isAssetShaped(Object.values(asset)),
      isAssetShaped('019a5b12'),
      isAssetShaped(null),
    ]).toEqual([false, false, false, false, false]);
  });

  it('is shaped like an asset and names none where a member is not what an asset holds', () => {
    expect([
      assetReferenceOf({ ...asset, sha256: 'not a digest' }),
      assetReferenceOf({ ...asset, bytes: -1 }),
      assetReferenceOf({ ...asset, id: 7 }),
      assetReferenceOf({ ...asset, name: 'report.pdf' }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('is found at its JSON Pointer wherever it is held, and nothing inside it is looked at again', () => {
    const lookalike = { ...asset, sha256: 'not a digest' };
    const value = { page: asset, 'a/b': [{ '~': lookalike }], text: 'plain', nested: { list: [1, asset] } };

    expect(assetsIn(value)).toEqual([
      { pointer: '/page', reference: asset, shaped: asset },
      { pointer: '/a~1b/0/~0', reference: undefined, shaped: lookalike },
      { pointer: '/nested/list/1', reference: asset, shaped: asset },
    ]);
    expect([assetsIn(asset), holdsAnAsset(value), holdsAnAsset({ text: 'plain', list: [1, null] })]).toEqual([
      [{ pointer: '', reference: asset, shaped: asset }],
      true,
      false,
    ]);
  });
});

describe('what an asset holds', () => {
  it('is text for a text media type, JSON for JSON, and a file for anything else, by the media type alone', () => {
    expect(
      [
        'text/plain',
        'text/markdown; charset=utf-8',
        'TEXT/CSV',
        'application/json',
        'application/ld+json',
        'Application/JSON; charset=utf-8',
        'application/pdf',
        'image/png',
        'application/x-ndjson',
        '',
      ].map((mediaType) => assetContentOf(mediaType)),
    ).toEqual(['text', 'text', 'text', 'json', 'json', 'json', 'file', 'file', 'file', 'file']);
  });
});

describe('a playbook that holds no assets', () => {
  it('refuses every asset as none of its own, and words why each other asset cannot be used', async () => {
    const refused = await Effect.runPromiseExit(noAssetsHeld.held({ org: 'acme', playbook: 'billing' }, asset));

    expect(refused).toEqual(
      Exit.fail({
        id: asset.id,
        detail: `No asset of this playbook has the id ${asset.id}; give an asset this playbook keeps, as the run that made it answered it`,
      }),
    );
    expect([
      assetUnusable('other_bytes', asset),
      assetUnusable('expired', asset),
      assetUnusable('content_gone', asset),
    ]).toEqual([
      {
        id: asset.id,
        detail: `No asset of this playbook has the id ${asset.id} with the SHA-256 ${'a'.repeat(64)}; give an asset this playbook keeps, as the run that made it answered it`,
      },
      { id: asset.id, detail: `The asset ${asset.id} has expired; run again what made it, for a fresh copy` },
      {
        id: asset.id,
        detail: `The content of the asset ${asset.id} is no longer kept; run again what made it, for a fresh copy`,
      },
    ]);
  });
});

describe('the keeper of a run’s values as assets', () => {
  it('is none until a shell provides one, so a runtime composed without it keeps no value', () => {
    const keeper = Effect.runSync(
      Effect.gen(function* () {
        return yield* AssetKeeper;
      }),
    );

    expect(keeper).toBeNull();
  });
});
