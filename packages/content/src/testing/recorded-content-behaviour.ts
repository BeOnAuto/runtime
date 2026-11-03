import { describe, expect, it } from 'vitest';

import { mostContentChunkBytes } from '../content/content-chunks.ts';
import { sha256Of } from '../content/content-digest.ts';
import type { AskedRange, ContentPart } from '../content/content-parts.ts';
import { textOfContent, textToKeep } from '../content/streamed-content.ts';
import type { ContentEntry } from './content-entry.ts';
import {
  alpha,
  answerOfAbout,
  generatedStream,
  beta,
  brokenAfter,
  generated,
  json,
  octets,
  present,
  readBack,
  refusalOf,
  resultOf,
} from './content-samples.ts';

function keptWhole(entry: ContentEntry): void {
  it.each([
    ['no bytes', 0],
    ['100 bytes', 100],
    ['64 KiB', 65_536],
    ['5 MB', 5_000_000],
    ['64 MiB', 67_108_864],
  ])(
    'keeps %s put as a stream whole, answers its digest, its size and its media type, and streams them back in pieces of at most 1 MiB',
    { timeout: 120_000 },
    async (_size, bytes) => {
      const store = await entry.aStore();
      const { sha256, content } = await generated(bytes);

      const kept = await resultOf(store.content.put(alpha, content()));
      const read = await readBack(await present(store.content.get(alpha, sha256)));

      expect(kept).toEqual({ sha256, bytes, mediaType: octets });
      expect(read).toMatchObject({ bytes, sha256, mediaType: octets, declared: bytes });
      expect(read?.largestPiece).toBeLessThanOrEqual(mostContentChunkBytes);
      expect(await store.unnamedLeft()).toBe(0);
    },
  );
}

function keptOnce(entry: ContentEntry): void {
  it('keeps a text as its UTF-8 under the digest its fact carries, once, with the media type it was first put with, in its playbook alone', async () => {
    const store = await entry.aStore();
    const text = answerOfAbout(1_500_000);
    const sha256 = sha256Of(text);

    const kept = [
      await resultOf(store.content.put(alpha, textToKeep(text, json))),
      await resultOf(store.content.put(alpha, textToKeep(text, 'text/plain'))),
    ];
    const read = await present(store.content.get(alpha, sha256));

    expect(kept).toEqual([
      { sha256, bytes: Buffer.byteLength(text), mediaType: json },
      { sha256, bytes: Buffer.byteLength(text), mediaType: json },
    ]);
    expect([read.mediaType, await resultOf(textOfContent(read))]).toEqual([json, text]);
    expect(await resultOf(store.content.get(beta, sha256))).toBeUndefined();
    expect(await resultOf(store.content.get(alpha, sha256Of('another answer')))).toBeUndefined();
    expect(await store.unnamedLeft()).toBe(0);
  });

  it('keeps a content it holds once, put again whole or with the digest it is expected to have', async () => {
    const store = await entry.aStore();
    const small = await generated(1000);
    const large = await generated(2_500_000);
    await resultOf(store.content.put(alpha, small.content()));
    await resultOf(store.content.put(alpha, large.content()));

    const again = await Promise.all([
      resultOf(store.content.put(alpha, small.content())),
      resultOf(store.content.put(alpha, large.content())),
      resultOf(store.content.put(alpha, { ...large.content(), expected: { sha256: large.sha256 } })),
    ]);

    expect(again).toEqual([
      { sha256: small.sha256, bytes: 1000, mediaType: octets },
      { sha256: large.sha256, bytes: 2_500_000, mediaType: octets },
      { sha256: large.sha256, bytes: 2_500_000, mediaType: octets },
    ]);
    expect(await store.unnamedLeft()).toBe(0);
  });
}

function putRefused(entry: ContentEntry): void {
  it('refuses bytes of another digest or size than expected, and a stream that fails, keeping nothing of them', async () => {
    const store = await entry.aStore();
    const right = await generated(2_500_000);
    const wrong = await generated(2_500_000, 11);

    const refused = await Promise.all([
      refusalOf(store.content.put(alpha, { ...wrong.content(), expected: { sha256: right.sha256 } })),
      refusalOf(store.content.put(alpha, { ...right.content(), expected: { bytes: 2_500_001 } })),
      refusalOf(store.content.put(alpha, brokenAfter(mostContentChunkBytes + 10))),
    ]);

    expect(refused).toEqual([
      expect.objectContaining({
        _tag: 'content_refused',
        because: 'not_its_digest',
        detail: `The content's SHA-256 is ${wrong.sha256}, where ${right.sha256} was expected`,
        found: { sha256: wrong.sha256, bytes: 2_500_000 },
      }),
      expect.objectContaining({
        _tag: 'content_refused',
        because: 'not_its_size',
        detail: 'The content holds 2500000 bytes, where 2500001 were expected',
        found: { sha256: right.sha256, bytes: 2_500_000 },
      }),
      expect.objectContaining({
        _tag: 'content_refused',
        because: 'stream_failed',
        detail: "The content's stream failed before its end",
        cause: new Error('The connection dropped'),
      }),
    ]);
    expect(await resultOf(store.content.get(alpha, right.sha256))).toBeUndefined();
    expect(await resultOf(store.content.get(alpha, wrong.sha256))).toBeUndefined();
    expect(await store.unnamedLeft()).toBe(0);
  });
}

function heldDigestDefended(entry: ContentEntry): void {
  it('refuses wrong bytes put with the digest of a content the playbook holds, writing nothing and leaving the content whole', async () => {
    const store = await entry.aStore();
    const right = await generated(2_500_000);
    const wrong = await generated(2_500_000, 11);
    await resultOf(store.content.put(alpha, right.content()));

    const refused = await refusalOf(
      store.content.put(alpha, { ...wrong.content(), expected: { sha256: right.sha256 } }),
    );

    expect(refused).toMatchObject({ _tag: 'content_refused', because: 'not_its_digest' });
    expect(await readBack(await present(store.content.get(alpha, right.sha256)))).toMatchObject({
      sha256: right.sha256,
      bytes: 2_500_000,
    });
    expect(await store.unnamedLeft()).toBe(0);
  });
}

function putRaced(entry: ContentEntry): void {
  it('keeps the right bytes of a digest that a wrong put raced, and one of two puts of a digest made at once', async () => {
    const store = await entry.aStore();
    const right = await generated(2_500_000);
    const wrong = await generated(2_500_000, 11);
    const expected = { sha256: right.sha256 };

    const raced = await Promise.all([
      refusalOf(store.content.put(alpha, { ...wrong.content(), expected })),
      resultOf(store.content.put(alpha, { ...right.content(), expected })),
      resultOf(store.elsewhere.put(alpha, right.content())),
    ]);

    expect(raced).toEqual([
      expect.objectContaining({ because: 'not_its_digest' }),
      { sha256: right.sha256, bytes: 2_500_000, mediaType: octets },
      { sha256: right.sha256, bytes: 2_500_000, mediaType: octets },
    ]);
    expect(await readBack(await present(store.content.get(alpha, right.sha256)))).toMatchObject({
      sha256: right.sha256,
      bytes: 2_500_000,
    });
    expect(await store.unnamedLeft()).toBe(0);
  });
}

const bytesInParts = 2_500_000;

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface PartRead {
  readonly size: number;
  readonly mediaType: string;
  readonly part: { readonly start: number; readonly end: number; readonly bytes: number; readonly sha256: string };
}

async function partReadOf({ size, mediaType, part }: ContentPart): Promise<PartRead | Omit<ContentPart, 'part'>> {
  if (part === undefined) return { size, mediaType };
  const { start, end, bytes, stream } = part;
  return { size, mediaType, part: { start, end, bytes, sha256: sha256Of(await bytesOf(stream)) } };
}

function partOfTheWhole(whole: Readonly<Uint8Array>, start: number, end: number): PartRead['part'] {
  return { start, end, bytes: end - start + 1, sha256: sha256Of(whole.subarray(start, end + 1)) };
}

function keptInParts(entry: ContentEntry): void {
  it('reads a part from its first byte to its last, across chunks, to the end where the range is open or runs past it, with the size of the whole', async () => {
    const store = await entry.aStore();
    const { sha256, content } = await generated(bytesInParts);
    await resultOf(store.content.put(alpha, content()));
    const whole = await bytesOf(generatedStream(bytesInParts, 7));
    const readOf = async (asked: AskedRange) => partReadOf(await present(store.content.getPart(alpha, sha256, asked)));

    const parts = [
      await readOf({ start: 0, end: 0 }),
      await readOf({ start: 1_000_000, end: 2_100_000 }),
      await readOf({ start: 2_400_000, end: undefined }),
      await readOf({ start: 10, end: 9_999_999 }),
    ];

    expect(parts).toEqual([
      { size: bytesInParts, mediaType: octets, part: partOfTheWhole(whole, 0, 0) },
      { size: bytesInParts, mediaType: octets, part: partOfTheWhole(whole, 1_000_000, 2_100_000) },
      { size: bytesInParts, mediaType: octets, part: partOfTheWhole(whole, 2_400_000, bytesInParts - 1) },
      { size: bytesInParts, mediaType: octets, part: partOfTheWhole(whole, 10, bytesInParts - 1) },
    ]);
  });

  it('answers no part where the range starts past the content or is no range of bytes, with its size, and nothing for a digest it does not hold', async () => {
    const store = await entry.aStore();
    const { sha256, content } = await generated(100);
    await resultOf(store.content.put(alpha, content()));
    const noPart = async (asked: AskedRange) => partReadOf(await present(store.content.getPart(alpha, sha256, asked)));

    const parts = [
      await noPart({ start: 100, end: undefined }),
      await noPart({ start: -1, end: 9 }),
      await noPart({ start: 9, end: 2 }),
    ];

    expect(parts).toEqual(Array.from({ length: 3 }, () => ({ size: 100, mediaType: octets })));
    expect(await resultOf(store.content.getPart(alpha, 'a'.repeat(64), { start: 0, end: 9 }))).toBeUndefined();
    expect(await resultOf(store.content.getPart(beta, sha256, { start: 0, end: 9 }))).toBeUndefined();
  });
}

export function recordedContentBehaviour(entry: ContentEntry): void {
  describe('the content a playbook recorded', () => {
    keptWhole(entry);
    keptOnce(entry);
    keptInParts(entry);
  });
  describe('the content a playbook was given to keep, refused', () => {
    putRefused(entry);
    heldDigestDefended(entry);
    putRaced(entry);
  });
}
