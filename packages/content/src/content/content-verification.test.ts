import { Buffer } from 'node:buffer';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { deliveredBeforeFailing, readThrough } from '../testing/content-samples.ts';
import { sha256Digest, sha256Of } from './content-digest.ts';
import { leftUnread } from './content-intake.ts';
import { type AskedRange, rangeWithin } from './content-parts.ts';
import { notTheBytesOfItsDigest, notTheBytesOfItsPart } from './content-refusals.ts';
import { measuredStream, verifiedStream } from './content-verification.ts';
import { NotTheBytesKept } from './not-the-bytes-kept.ts';
import { contentOfBytes, contentOfText, textOfContent, textToKeep } from './streamed-content.ts';
import { textPieceCodeUnits } from './text-pieces.ts';

interface Source {
  readonly stream: ReadableStream<Uint8Array>;
  readonly cancelled: () => unknown;
}

function sourceOf(pieces: readonly string[], failure?: Readonly<Error>): Source {
  const left = pieces.map((piece) => new TextEncoder().encode(piece));
  let cancelled: unknown;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        const piece = left.shift();
        if (piece !== undefined) {
          controller.enqueue(piece);
        } else if (failure === undefined) {
          controller.close();
        } else {
          controller.error(failure);
        }
      },
      cancel: (reason) => {
        cancelled = reason ?? 'cancelled';
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, cancelled: () => cancelled };
}

const whole = 'alpha beta gamma';

const pieces = ['alpha ', 'beta ', 'gamma'];

const knownDigests: readonly (readonly [string | Readonly<Uint8Array>, string])[] = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['é', '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'],
  [Uint8Array.of(0xc3, 0xa9), '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'],
];

function digestedInParts(content: string | Readonly<Uint8Array>): string {
  const digest = sha256Digest();
  digest.update(content.slice(0, 1));
  digest.update(content.slice(1));
  return digest.hex();
}

async function piecesOf(text: string): Promise<readonly Readonly<Uint8Array>[]> {
  const piecesStreamedContent: Readonly<Uint8Array>[] = [];
  for await (const piece of textToKeep(text, 'application/json').stream) {
    piecesStreamedContent.push(piece);
  }
  return piecesStreamedContent;
}

describe('a stream verified against the digest and the size of a content', () => {
  it('hands over every piece of a content that is its digest, and an empty content as nothing', async () => {
    const read = await Promise.all([
      readThrough(verifiedStream(sha256Of(whole), 16, sourceOf(pieces).stream)),
      readThrough(verifiedStream(sha256Of(''), 0, sourceOf([]).stream)),
      readThrough(verifiedStream(sha256Of(''), 0, sourceOf(['']).stream)),
    ]);

    expect(read).toEqual([
      { bytes: 16, sha256: sha256Of(whole), largestPiece: 6 },
      { bytes: 0, sha256: sha256Of(''), largestPiece: 0 },
      { bytes: 0, sha256: sha256Of(''), largestPiece: 0 },
    ]);
  });

  it('hands over no last piece of bytes another digest names, nor of a content of one piece', async () => {
    const another = sha256Of('another');

    const delivered = await Promise.all([
      deliveredBeforeFailing(verifiedStream(another, 16, sourceOf(pieces).stream)),
      deliveredBeforeFailing(verifiedStream(another, 16, sourceOf([whole]).stream)),
    ]);

    expect(delivered).toEqual([
      { bytes: 11, failure: notTheBytesOfItsDigest(another) },
      { bytes: 0, failure: notTheBytesOfItsDigest(another) },
    ]);
  });
});

describe('a stream verified against the digest and the size of a content, that its source spoils', () => {
  it('fails a stream that ends before its size, after the pieces it had', async () => {
    const delivered = await deliveredBeforeFailing(verifiedStream(sha256Of(whole), 20, sourceOf(pieces).stream));

    expect(delivered).toEqual({ bytes: 16, failure: notTheBytesOfItsDigest(sha256Of(whole)) });
  });

  it('fails a stream that goes on past its size, without the piece that reached it, and cancels what is left', async () => {
    const reachingIt = sourceOf(pieces);
    const passingIt = sourceOf(pieces);

    const delivered = await Promise.all([
      deliveredBeforeFailing(verifiedStream(sha256Of('alpha beta '), 11, reachingIt.stream)),
      deliveredBeforeFailing(verifiedStream(sha256Of('alpha bet'), 9, passingIt.stream)),
    ]);

    expect(delivered).toEqual([
      { bytes: 6, failure: notTheBytesOfItsDigest(sha256Of('alpha beta ')) },
      { bytes: 6, failure: notTheBytesOfItsDigest(sha256Of('alpha bet')) },
    ]);
    expect([reachingIt.cancelled(), passingIt.cancelled()]).toEqual(['cancelled', 'cancelled']);
  });
});

describe('a stream verified against the digest and the size of a content, that its source fails', () => {
  it('fails with the failure of its source, after the pieces before it', async () => {
    const failure = new Error('The connection dropped');

    const delivered = await deliveredBeforeFailing(
      verifiedStream(sha256Of(whole), 16, sourceOf(['alpha '], failure).stream),
    );

    expect(delivered).toEqual({ bytes: 6, failure });
  });

  it('fails a source that streams a piece that is not bytes, and cancels it', async () => {
    let cancelled = false;
    const source = new ReadableStream<unknown>({
      pull: (controller) => {
        controller.enqueue('alpha');
      },
      cancel: () => {
        cancelled = true;
      },
    });

    const delivered = await deliveredBeforeFailing(verifiedStream(sha256Of(whole), 16, source));

    expect(delivered).toEqual({
      bytes: 0,
      failure: new Error(`The content kept under ${sha256Of(whole)} was read back in a piece that is not bytes`),
    });
    expect(cancelled).toBe(true);
  });

  it('cancels its source when its reader cancels it', async () => {
    const source = sourceOf(pieces);
    const stream = verifiedStream(sha256Of(whole), 16, source.stream);

    await stream.cancel('The reader left');

    expect(source.cancelled()).toBe('The reader left');
  });
});

describe('a stream of a part of a content, held to the length of the part', () => {
  it('hands over every piece of a part of its length', async () => {
    expect(await readThrough(measuredStream(sha256Of(whole), 16, sourceOf(pieces).stream))).toEqual({
      bytes: 16,
      sha256: sha256Of(whole),
      largestPiece: 6,
    });
  });

  it('fails a part that ends short of its length, and one that goes past it without the piece that did, cancelling what is left', async () => {
    const passingIt = sourceOf(pieces);

    const delivered = await Promise.all([
      deliveredBeforeFailing(measuredStream(sha256Of(whole), 20, sourceOf(pieces).stream)),
      deliveredBeforeFailing(measuredStream(sha256Of(whole), 9, passingIt.stream)),
    ]);

    expect(delivered).toEqual([
      { bytes: 16, failure: notTheBytesOfItsPart(sha256Of(whole), 20) },
      { bytes: 6, failure: notTheBytesOfItsPart(sha256Of(whole), 9) },
    ]);
    expect(passingIt.cancelled()).toBe('cancelled');
  });

  it('fails a piece that is not bytes, and cancels its source when its reader cancels it', async () => {
    const source = new ReadableStream<unknown>({
      pull: (controller) => {
        controller.enqueue('alpha');
      },
    });
    const left = sourceOf(pieces);

    const delivered = await deliveredBeforeFailing(measuredStream(sha256Of(whole), 16, source));
    await measuredStream(sha256Of(whole), 16, left.stream).cancel('The reader left');

    expect(delivered).toEqual({
      bytes: 0,
      failure: new Error(`The content kept under ${sha256Of(whole)} was read back in a piece that is not bytes`),
    });
    expect(left.cancelled()).toBe('The reader left');
  });
});

describe('the SHA-256 of a content', () => {
  it('is the known digest of no bytes, of "abc", and of a text as of its UTF-8, in lowercase hex, in hand', () => {
    expect(knownDigests.map(([content]) => sha256Of(content))).toEqual(knownDigests.map(([, digest]) => digest));
  });

  it('is the same known digest digested in parts as it streams', () => {
    expect(knownDigests.map(([content]) => digestedInParts(content))).toEqual(knownDigests.map(([, digest]) => digest));
  });

  it('is the digest of the UTF-8 of a text of many pieces, a character across where they meet among them', () => {
    const text = `${'x'.repeat(textPieceCodeUnits - 1)}\u{1D11E}\uD834 and more`.repeat(3);

    expect(sha256Of(text)).toBe(sha256Of(new Uint8Array(Buffer.from(text, 'utf8'))));
  });
});

describe('a content left unread', () => {
  it('cancels its stream, so its source stops making the bytes no one reads', async () => {
    const cancelled = Promise.withResolvers<unknown>();
    const stream = new ReadableStream<Uint8Array>({
      cancel: (reason) => {
        cancelled.resolve(reason);
      },
    });

    await Effect.runPromise(leftUnread(stream));

    await expect(cancelled.promise).resolves.toBeUndefined();
    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined });
  });
});

describe('a range asked of a content of 100 bytes', () => {
  it('is held within the content from its first byte to its last, to the end where it is open or runs past it', () => {
    expect([
      rangeWithin({ start: 0, end: 9 }, 100),
      rangeWithin({ start: 90, end: undefined }, 100),
      rangeWithin({ start: 10, end: 1e20 }, 100),
      rangeWithin({ start: 99, end: Number.POSITIVE_INFINITY }, 100),
      rangeWithin({ start: 7, end: 7 }, 100),
    ]).toEqual([
      { start: 0, end: 9 },
      { start: 90, end: 99 },
      { start: 10, end: 99 },
      { start: 99, end: 99 },
      { start: 7, end: 7 },
    ]);
  });

  it('is no part where it starts at or past the end, before the first byte or between two bytes, or ends before it starts or between two bytes', () => {
    const asked: readonly AskedRange[] = [
      { start: 100, end: undefined },
      { start: 1e20, end: undefined },
      { start: -1, end: 9 },
      { start: 1.5, end: 9 },
      { start: Number.NaN, end: 9 },
      { start: 9, end: 2 },
      { start: 0, end: Number.NaN },
      { start: 0, end: 2.5 },
    ];

    expect(asked.filter((range) => rangeWithin(range, 100) !== undefined)).toEqual([]);
  });

  it('is no part of a content of no bytes', () => {
    expect(rangeWithin({ start: 0, end: undefined }, 0)).toBeUndefined();
  });
});

describe('the refusals of a content', () => {
  it('name a content a read found to be other bytes than its digest names', () => {
    expect(notTheBytesOfItsDigest('9f3e').message).toBe(
      'The content kept under 9f3e is not the bytes that digest names',
    );
  });

  it('are failures a reader tells apart from a read that failed on its way, whole or in part', () => {
    expect(notTheBytesOfItsDigest('9f3e')).toBeInstanceOf(NotTheBytesKept);
    expect(notTheBytesOfItsPart('9f3e', 12)).toBeInstanceOf(NotTheBytesKept);
    expect(new TypeError('terminated')).not.toBeInstanceOf(NotTheBytesKept);
  });
});

describe('a text to keep', () => {
  it('streams the UTF-8 of the text a piece at a time, never a piece of more than three bytes a code unit', async () => {
    const text = `${'x'.repeat(textPieceCodeUnits - 1)}\u{1D11E}é ✓`.repeat(4);

    const piecesStreamedContent = await piecesOf(text);

    expect({
      bytes: Buffer.concat(piecesStreamedContent).equals(Buffer.from(text, 'utf8')),
      several: piecesStreamedContent.length > 4,
      largest: Math.max(...piecesStreamedContent.map(({ byteLength }) => byteLength)) <= 3 * textPieceCodeUnits,
    }).toEqual({ bytes: true, several: true, largest: true });
  });

  it('streams nothing of no text', async () => {
    await expect(piecesOf('')).resolves.toEqual([]);
  });
});

describe('a content as a stream of bytes', () => {
  it('carries a text as its UTF-8 bytes, with their size and its media type, and reads back as that text', async () => {
    const content = contentOfText('é ✓ 𝄞', 'text/plain');

    expect({ bytes: content.bytes, mediaType: content.mediaType }).toEqual({ bytes: 11, mediaType: 'text/plain' });
    await expect(Effect.runPromise(textOfContent(content))).resolves.toBe('é ✓ 𝄞');
  });

  it('carries bytes as they are, and fails as a defect when they are read as text and are not UTF-8', async () => {
    const bytes = Uint8Array.of(0xff, 0xfe);
    const content = contentOfBytes(bytes, 'application/octet-stream');
    bytes.fill(0);

    expect(content.bytes).toBe(2);
    await expect(Effect.runPromise(textOfContent(content))).rejects.toThrow('The encoded data was not valid');
  });
});
