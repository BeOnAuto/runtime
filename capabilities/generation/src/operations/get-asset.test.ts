import { createHash } from 'node:crypto';

import { contentAddressesUnder } from '@on.auto/identity';
import { Redacted, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { assetIdOf, day, issuesOf, numberedHarness, refusalOf, runIdOf } from '../run-testing/run-outcomes.ts';
import {
  alpha,
  beta,
  harnessStartsAt,
  imageSource,
  onePixelPng,
  sourceWith,
  type GenerationHarness,
} from '../testing/index.ts';
import { AssetReadSchema, type AssetRead } from './asset-read.ts';
import { defineGetAsset } from './get-asset.ts';

const pngDigest = createHash('sha256').update(onePixelPng).digest('hex');

const minute = 60_000;

const image = ['produces: image', 'model: gateway/openai/gpt-image-2'];

function ownOrigin(): string {
  return 'http://127.0.0.1:5555';
}

const decodeRead = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: AssetReadSchema }),
);

async function readOf(playbook: GenerationHarness, id: string): Promise<AssetRead> {
  return decodeRead(await playbook.assetOf(id)).output;
}

function wordsOf(read: AssetRead): string | undefined {
  return defineGetAsset({}).registration.plainLanguage?.outcome(read, { id: read.id });
}

function momentOf(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

interface Signed {
  readonly playbook: GenerationHarness;
  readonly signing: ReturnType<typeof contentAddressesUnder>;
  readonly passes: (milliseconds: number) => void;
}

function signedHarness(): Signed {
  const clock = { now: harnessStartsAt };
  const signing = contentAddressesUnder(Redacted.make(new Uint8Array(32).fill(7)), () => clock.now);
  const playbook = numberedHarness({ addresses: { signedContentAddress: signing.signedContentAddress, ownOrigin } });
  return {
    playbook,
    signing,
    passes: (milliseconds) => {
      clock.now += milliseconds;
      playbook.passes(milliseconds);
    },
  };
}

function presentedIn(address: string | null): { readonly until: string | undefined; readonly sig: string | undefined } {
  const { searchParams } = new URL(String(address));
  return { until: searchParams.get('until') ?? undefined, sig: searchParams.get('sig') ?? undefined };
}

async function onePictureIn(playbook: GenerationHarness, source = imageSource): Promise<string> {
  await playbook.define('picture', source);
  await playbook.run('picture', { product: 'a teapot' }, runIdOf(1));
  return assetIdOf(1);
}

describe('an asset read by its id', () => {
  it('answers what the playbook keeps of it and the model that made it, with an address signed as it is read for fifteen minutes', async () => {
    const { playbook, signing, passes } = signedHarness();
    const id = await onePictureIn(playbook);
    passes(20 * minute);
    const until = Math.floor((harnessStartsAt + 20 * minute) / 1000) + 900;

    const read = await readOf(playbook, id);

    expect(read).toEqual({
      id,
      media_type: 'image/png',
      bytes: onePixelPng.byteLength,
      sha256: pngDigest,
      model: 'gateway/openai/gpt-image-2',
      kept_at: momentOf(harnessStartsAt),
      expires_at: momentOf(harnessStartsAt + 30 * day),
      expired_at: null,
      expired: false,
      content_removed: false,
      address: signing.signedContentAddress(ownOrigin(), alpha, pngDigest, until),
      address_until: momentOf(until * 1000),
    });
    expect(signing.checkedAddress(alpha, pngDigest, presentedIn(read.address))).toBe('signed');
    expect(wordsOf(read)).toBe(
      `The asset, an image of ${onePixelPng.byteLength} bytes, is kept until 2026-12-01; its address, in the details below, opens it for 15 minutes.`,
    );
  });
});

describe('an asset read where the runtime signs no address', () => {
  it('answers no address, and says that none opens it', async () => {
    const playbook = numberedHarness();
    const id = await onePictureIn(playbook);

    const read = await readOf(playbook, id);

    expect([read.address, read.address_until]).toEqual([null, null]);
    expect(wordsOf(read)).toBe(
      `The asset, an image of ${onePixelPng.byteLength} bytes, is kept until 2026-12-01, and no address opens it.`,
    );
  });
});

describe('the id an asset is read by', () => {
  it('is taken in any case, and answered in lowercase', async () => {
    const playbook = numberedHarness();
    const id = await onePictureIn(playbook);

    expect((await readOf(playbook, id.toUpperCase())).id).toBe(id);
  });

  it('is refused at its field where it is no UUID, before anything is read', async () => {
    const playbook = numberedHarness();

    expect(issuesOf(await playbook.assetOf('../runs/a-run'))).toEqual([expect.objectContaining({ pointer: '/id' })]);
  });

  it('answers not_found where no asset of the playbook has it, an asset of another playbook among them', async () => {
    const playbook = numberedHarness();
    const id = await onePictureIn(playbook);
    const notFound = { reason: 'not_found', kind: undefined, detail: 'There is no such asset in this playbook' };

    expect([refusalOf(await playbook.assetOf(assetIdOf(9))), refusalOf(await playbook.assetOf(id, beta))]).toEqual([
      notFound,
      notFound,
    ]);
    expect(defineGetAsset({}).registration.plainLanguage?.attempt({ id })).toBe('look up the asset');
  });
});

describe('an asset whose time is up', () => {
  it('answers no address from the moment it expires, and that its content was removed once its expiry is recorded', async () => {
    const { playbook, passes } = signedHarness();
    const id = await onePictureIn(playbook, sourceWith([...image, 'expires: P1D']));
    passes(day);

    const due = await readOf(playbook, id);
    await playbook.expireAt(harnessStartsAt + day);
    const recorded = await readOf(playbook, id);

    expect(due).toMatchObject({
      expires_at: momentOf(harnessStartsAt + day),
      expired_at: null,
      expired: true,
      content_removed: false,
      address: null,
      address_until: null,
    });
    expect(wordsOf(due)).toBe(
      `The asset, an image of ${onePixelPng.byteLength} bytes, has expired, so no address opens it.`,
    );
    expect(recorded).toMatchObject({
      expires_at: null,
      expired_at: momentOf(harnessStartsAt + day),
      expired: true,
      content_removed: true,
      address: null,
      address_until: null,
    });
    expect(wordsOf(recorded)).toBe(
      `The asset, an image of ${onePixelPng.byteLength} bytes, has expired, and its content was removed.`,
    );
  });
});

describe('an asset whose time is up, whose bytes another asset holds', () => {
  it('says its content stays while another asset holds the same bytes, whose address is still signed', async () => {
    const { playbook, passes } = signedHarness();
    await playbook.define('short', sourceWith([...image, 'expires: P1D']));
    await playbook.define('long', sourceWith([...image, 'expires: P3D']));
    await playbook.run('short', {}, runIdOf(1));
    await playbook.run('long', {}, runIdOf(2));
    passes(day);
    await playbook.expireAt(harnessStartsAt + day);

    const [expired, kept] = [await readOf(playbook, assetIdOf(1)), await readOf(playbook, assetIdOf(2))];

    expect(expired).toMatchObject({ expires_at: null, content_removed: false, address: null });
    expect(wordsOf(expired)).toBe(
      `The asset, an image of ${onePixelPng.byteLength} bytes, has expired, so no address opens it.`,
    );
    expect([kept.content_removed, kept.address === null]).toEqual([false, false]);
  });
});
