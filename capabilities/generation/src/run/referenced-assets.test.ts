import { Buffer } from 'node:buffer';

import { streamPrefixOfPlaybook } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assetDecider } from '../assets/asset-decider.ts';
import { assetIdOf, day, issuesOf, keptDataOf, keptFactOf, numberedHarness, ran } from '../run-testing/run-outcomes.ts';
import {
  alpha,
  answeredByKind,
  audioSource,
  harnessStartsAt,
  imageSource,
  onePixelPng,
  referringSource,
  type GatewayAnswering,
  type GenerationHarness,
} from '../testing/index.ts';

async function withAPicture(answering: GatewayAnswering = answeredByKind()): Promise<GenerationHarness> {
  const playbook = numberedHarness({ answering });
  await playbook.define('picture', imageSource);
  await playbook.define('again', referringSource);
  await ran(playbook, 'picture', { product: 'a teapot' }, 1);
  return playbook;
}

async function issuesAt(playbook: GenerationHarness, input: object, index = 2) {
  return issuesOf(await ran(playbook, 'again', { product: 'a teapot', ...input }, index));
}

function listing(pointers: string): string {
  return [
    '---',
    'produces: image',
    'model: gateway/openai/gpt-image-1',
    `references: [${pointers}]`,
    '---',
    'Both',
  ].join('\n');
}

const large = Buffer.concat([onePixelPng, Buffer.alloc(1_300_000)]);

const largeImages: GatewayAnswering = (asked) =>
  asked.path.endsWith('/generations')
    ? Response.json({ data: [{ b64_json: large.toString('base64') }] })
    : answeredByKind()(asked);

const unidentified = { pointer: '/input/photo', detail: 'Expected the id of an asset of this playbook' };

describe('a reference of a generation function', () => {
  it('sends the bytes of an asset of the playbook to the model, and records which asset it took', async () => {
    const playbook = await withAPicture();

    const outcome = await ran(playbook, 'again', { product: 'a teapot', photo: assetIdOf(1) }, 2);
    const kept = keptDataOf(await playbook.factsOf(assetIdOf(2)));

    expect(outcome.status).toBe('succeeded');
    expect(playbook.gateway.asked().map(({ path, files }) => ({ path, files }))).toEqual([
      { path: '/v1/images/generations', files: [] },
      {
        path: '/v1/images/edits',
        files: [{ name: 'reference-1.png', type: 'image/png', bytes: onePixelPng.byteLength }],
      },
    ]);
    expect(kept.references).toEqual([{ id: assetIdOf(1), sha256: (await playbook.rowOf(assetIdOf(1)))?.sha256 }]);
  });

  it('is refused where the input holds no id there, or the id of no asset of this playbook', async () => {
    const playbook = await withAPicture();

    expect([
      await issuesAt(playbook, {}),
      await issuesAt(playbook, { photo: 7 }, 3),
      await issuesAt(playbook, { photo: 'nope' }, 4),
    ]).toEqual([
      [unidentified],
      [unidentified],
      [{ pointer: '/input/photo', detail: 'No asset of this playbook has the id nope' }],
    ]);
  });
});

describe('a reference to an asset of another playbook', () => {
  it('is refused as the id of no asset of this playbook, though the asset is kept in another', async () => {
    const playbook = await withAPicture();
    const kept = keptFactOf(await playbook.factsOf(assetIdOf(1)));
    const beta = { org: alpha.org, playbook: 'beta' };
    await Effect.runPromise(
      playbook.ledger.service.execute(`${streamPrefixOfPlaybook(beta)}assets/${assetIdOf(9)}`, assetDecider, {
        event: { type: 'asset_kept', data: kept.data },
        context: kept.context,
      }),
    );

    expect(await issuesAt(playbook, { photo: assetIdOf(9) })).toEqual([
      { pointer: '/input/photo', detail: `No asset of this playbook has the id ${assetIdOf(9)}` },
    ]);
  });
});

describe('a reference to an asset the model cannot take', () => {
  it('is refused where the asset expired, whether or not its expiry was recorded yet', async () => {
    const playbook = await withAPicture();
    playbook.passes(31 * day);
    const expired = [{ pointer: '/input/photo', detail: `The asset ${assetIdOf(1)} has expired` }];

    const unrecorded = await issuesAt(playbook, { photo: assetIdOf(1) });
    await playbook.expireAt(harnessStartsAt + 31 * day);
    const recorded = await issuesAt(playbook, { photo: assetIdOf(1) }, 3);

    expect([unrecorded, recorded]).toEqual([expired, expired]);
  });

  it('is refused where the asset is of a media type the model does not take, or larger than it takes of one reference', async () => {
    const playbook = await withAPicture(largeImages);
    await playbook.define('welcome', audioSource);
    await ran(playbook, 'welcome', { shop: 'the shop' }, 9);

    expect([
      await issuesAt(playbook, { photo: assetIdOf(2) }),
      await issuesAt(playbook, { photo: assetIdOf(1) }, 3),
    ]).toEqual([
      [
        {
          pointer: '/input/photo',
          detail: `The asset ${assetIdOf(2)} is audio/mpeg, which openai/gpt-image-1 does not take; it takes image/png, image/jpeg, or image/webp`,
        },
      ],
      [
        {
          pointer: '/input/photo',
          detail: `The asset ${assetIdOf(1)} takes 1.2 MiB, more than the 1 MiB openai/gpt-image-1 takes of one reference`,
        },
      ],
    ]);
  });

  it('is refused where the content of the asset is no longer kept', async () => {
    const playbook = await withAPicture();
    const row = await playbook.rowOf(assetIdOf(1));
    await Effect.runPromise(playbook.store.delete(alpha, String(row?.sha256)));

    expect(await issuesAt(playbook, { photo: assetIdOf(1) })).toEqual([
      { pointer: '/input/photo', detail: `The content of the asset ${assetIdOf(1)} is no longer kept` },
    ]);
  });
});

describe('a reference inside a list of the input', () => {
  it('reads an id inside a list, and none past its end or under a name a list does not have', async () => {
    const playbook = await withAPicture();
    await playbook.define('listed', listing('/photos/0, /photos/1'));
    await playbook.define('named', listing('/photos/0, /photos/x'));

    const past = await ran(playbook, 'listed', { photos: [assetIdOf(1)] }, 5);
    const named = await ran(playbook, 'named', { photos: [assetIdOf(1)] }, 6);

    expect([issuesOf(past), issuesOf(named)]).toEqual([
      [{ pointer: '/input/photos/1', detail: 'Expected the id of an asset of this playbook' }],
      [{ pointer: '/input/photos/x', detail: 'Expected the id of an asset of this playbook' }],
    ]);
  });
});
