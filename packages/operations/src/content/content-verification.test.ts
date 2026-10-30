import { describe, expect, it } from 'vitest';

import { deliveredBeforeFailing, readThrough } from '../content-testing/content-samples.ts';
import { sha256Of } from './content-digest.ts';
import { notTheBytesOfItsDigest } from './content-refusals.ts';
import { verifiedStream } from './content-verification.ts';

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
