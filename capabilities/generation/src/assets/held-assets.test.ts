import { at, readThrough } from '@on.auto/content/testing';
import {
  streamPrefixOfOrg,
  type AssetReference,
  type AssetUnusable,
  type HeldAsset,
  type PlaybookAddress,
} from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import { aPageARunReturned, aRunIn, assetIdOf, day } from '../run-testing/run-outcomes.ts';
import {
  alpha,
  beta,
  generationHarness,
  harnessStartsAt,
  onePixelPng,
  type GenerationHarness,
} from '../testing/index.ts';
import { assetsHeld, type AssetReading } from './held-assets.ts';
import { toolImagesKept } from './tool-images.ts';

const notKept = `The content of the asset ${assetIdOf(1)} is no longer kept; run again what made it, for a fresh copy`;

async function keptImage(playbook: GenerationHarness, bounds = generationBounds): Promise<string> {
  const definitionKey = await aRunIn(playbook, 'run-1');
  const keep = toolImagesKept({
    ledger: playbook.ledger.service,
    content: playbook.ledger.service.content,
    bounds,
    newAssetId: () => assetIdOf(1),
  });
  await at(
    harnessStartsAt,
    keep({
      playbook: alpha,
      bytes: onePixelPng,
      call: { call_id: 'toolu_01', server: 'browser', tool: 'browser_take_screenshot' },
      context: {
        by: 'acme-admin',
        runId: 'run-1',
        definitionType: 'reasoning',
        definitionName: 'check-the-order',
        definitionVersion: 1,
      },
      lineage: { causationId: 'start-1', correlationId: 'run-1' },
    }),
  );
  return definitionKey;
}

async function referenceOf(playbook: GenerationHarness, id: string): Promise<AssetReference> {
  const row = await playbook.rowOf(id);
  return {
    id,
    media_type: String(row?.media_type),
    bytes: Number(row?.bytes),
    sha256: String(row?.sha256),
    address: null,
    address_until: null,
  };
}

function readingOf(playbook: GenerationHarness): AssetReading {
  return { ledger: playbook.ledger.service, content: playbook.ledger.service.content };
}

function heldAt(reading: AssetReading, moment: number, owner: PlaybookAddress, reference: AssetReference) {
  return at(moment, assetsHeld(reading).held(owner, reference));
}

function refusedAt(reading: AssetReading, moment: number, owner: PlaybookAddress, reference: AssetReference) {
  return at(moment, Effect.flip(assetsHeld(reading).held(owner, reference)));
}

function bytesOpened(held: HeldAsset) {
  return Effect.runPromise(Effect.flatMap(held.opened(), (stream) => Effect.promise(() => readThrough(stream))));
}

function withHead(playbook: GenerationHarness, head: { readonly erasedAt?: number } | undefined): AssetReading {
  const kept = head === undefined ? undefined : { bytes: 1, mediaType: 'image/png', keptAt: harnessStartsAt, ...head };
  return {
    ledger: playbook.ledger.service,
    content: { get: playbook.ledger.service.content.get, getHead: () => Effect.succeed(kept) },
  };
}

describe('an asset a step names', () => {
  it('is held by its playbook as the file or text it is', async () => {
    const playbook = generationHarness();
    const definitionKey = await keptImage(playbook);
    const page = await aPageARunReturned(
      playbook.ledger.service,
      { playbook: alpha, definitionKey },
      assetIdOf(2),
      harnessStartsAt,
    );
    const reading = readingOf(playbook);

    expect(await heldAt(reading, harnessStartsAt, alpha, await referenceOf(playbook, assetIdOf(1)))).toMatchObject({
      id: assetIdOf(1),
      mediaType: 'image/png',
      bytes: onePixelPng.byteLength,
      content: 'file',
    });
    expect(await heldAt(reading, harnessStartsAt, alpha, await referenceOf(playbook, assetIdOf(2)))).toMatchObject({
      id: assetIdOf(2),
      mediaType: 'text/markdown',
      bytes: page.bytes,
      sha256: page.sha256,
      content: 'text',
    });
  });

  it('opens on its bytes each time it is asked', async () => {
    const playbook = generationHarness();
    await keptImage(playbook);
    const held = await heldAt(readingOf(playbook), harnessStartsAt, alpha, await referenceOf(playbook, assetIdOf(1)));

    const [first, second] = await Promise.all([bytesOpened(held), bytesOpened(held)]);

    expect([first.bytes, second.bytes, first.sha256]).toEqual([
      onePixelPng.byteLength,
      onePixelPng.byteLength,
      second.sha256,
    ]);
  });
});

const keptRemedy = 'give an asset this playbook keeps, as the run that made it answered it';

describe('an asset a step names and cannot use', () => {
  it('is refused where another playbook holds it, or its id holds other bytes than the digest it names', async () => {
    const playbook = generationHarness();
    await keptImage(playbook);
    const reference = await referenceOf(playbook, assetIdOf(1));
    const reading = readingOf(playbook);

    expect([
      await refusedAt(reading, harnessStartsAt, beta, reference),
      await refusedAt(reading, harnessStartsAt, alpha, { ...reference, sha256: 'b'.repeat(64) }),
    ]).toEqual([
      { id: assetIdOf(1), detail: `No asset of this playbook has the id ${assetIdOf(1)}; ${keptRemedy}` },
      {
        id: assetIdOf(1),
        detail: `No asset of this playbook has the id ${assetIdOf(1)} with the SHA-256 ${'b'.repeat(64)}; ${keptRemedy}`,
      },
    ]);
  });

  it('is refused once it has expired, and once its content is no longer kept as it is opened', async () => {
    const playbook = generationHarness();
    await keptImage(playbook, { ...generationBounds, keptMs: 90 * day });
    const reference = await referenceOf(playbook, assetIdOf(1));
    const reading = readingOf(playbook);
    const expired = await refusedAt(reading, harnessStartsAt + 91 * day, alpha, reference);
    const live = await heldAt(reading, harnessStartsAt, alpha, reference);
    await Effect.runPromise(playbook.store.delete(streamPrefixOfOrg(alpha), reference.sha256));

    expect([expired, await Effect.runPromise(Effect.flip(live.opened()))]).toEqual([
      { id: assetIdOf(1), detail: `The asset ${assetIdOf(1)} has expired; run again what made it, for a fresh copy` },
      { id: assetIdOf(1), detail: notKept },
    ]);
  });

  it('is refused before it is opened where its content has no head, or an erased one', async () => {
    const playbook = generationHarness();
    await keptImage(playbook);
    const reference = await referenceOf(playbook, assetIdOf(1));

    const refused: readonly AssetUnusable[] = await Promise.all(
      [undefined, { erasedAt: harnessStartsAt }].map((head: { readonly erasedAt?: number } | undefined) =>
        refusedAt(withHead(playbook, head), harnessStartsAt, alpha, reference),
      ),
    );

    expect(refused.map(({ detail }) => detail)).toEqual([notKept, notKept]);
  });
});

describe('an asset a step names, kept with no expiry', () => {
  it('is held years later where the runtime keeps an asset without end', async () => {
    const playbook = generationHarness();
    await keptImage(playbook);
    const reference = await referenceOf(playbook, assetIdOf(1));

    const held = await heldAt(readingOf(playbook), harnessStartsAt + 3650 * day, alpha, reference);

    expect(held.sha256).toBe(reference.sha256);
  });
});
