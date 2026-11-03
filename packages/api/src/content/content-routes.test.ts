import { sha256Of, textToKeep, type RecordedContent } from '@on.auto/content';
import { memoryRecordedContent } from '@on.auto/content/testing';
import { authenticatorFor, contentAddressesUnder } from '@on.auto/identity';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { contentAddressRoutes } from '../index.ts';
import { call, createTestHandler, type Answer } from '../testing/api-calls.ts';
import { acmeAdmin } from '../testing/operation-server.ts';

const key = Redacted.make(new Uint8Array(32).fill(5));

const alpha = { org: 'acme', playbook: 'alpha' };

const signedAt = 1_800_000_000;

const text = '{"image":"a cat"}';

const sha256 = sha256Of(text);

function at(seconds: number): () => number {
  return () => seconds * 1000;
}

function pathOf(address: string | undefined): string {
  const { pathname, search } = new URL(String(address));
  return `${pathname}${search}`;
}

const signing = contentAddressesUnder(key, at(signedAt));

function addressOf(digest: string, until = signedAt + 60): string {
  return pathOf(signing.signedContentAddress('http://localhost', alpha, digest, until));
}

async function holding(): Promise<RecordedContent> {
  const content = memoryRecordedContent();
  await Effect.runPromise(content.put(alpha, textToKeep(text, 'application/json')));
  return content;
}

type Served = Pick<RecordedContent, 'get' | 'getPart'>;

function servedBy(now: () => number, content: Served) {
  return createTestHandler({
    authenticator: authenticatorFor({ host: '0.0.0.0', apiKeys: [acmeAdmin.entry] }),
    routes: [contentAddressRoutes({ key, content, now })],
  }).handler;
}

function readingInASecond(kept: RecordedContent, aSecondPasses: () => void): Served {
  return {
    get: (playbook, digest) => Effect.andThen(Effect.sync(aSecondPasses), kept.get(playbook, digest)),
    getPart: (playbook, digest, asked) =>
      Effect.andThen(Effect.sync(aSecondPasses), kept.getPart(playbook, digest, asked)),
  };
}

function streaming(stream: ReadableStream<Uint8Array>): Served {
  return {
    get: () => Effect.succeed({ stream, bytes: 10, mediaType: 'image/png' }),
    getPart: () => Effect.die(new Error('No part of this content is read')),
  };
}

function cancelledStream(): { readonly stream: ReadableStream<Uint8Array>; readonly cancelled: Promise<string> } {
  const cancelled = Promise.withResolvers<string>();
  const stream = new ReadableStream<Uint8Array>({
    cancel: () => {
      cancelled.resolve('cancelled');
    },
  });
  return { stream, cancelled: cancelled.promise };
}

function partOf({ status, text: body, headers }: Omit<Answer, 'body'>) {
  return {
    status,
    body,
    type: headers.get('content-type'),
    length: headers.get('content-length'),
    range: headers.get('content-range'),
    accepts: headers.get('accept-ranges'),
  };
}

function servedAt(seconds: number, content: Served) {
  return servedBy(at(seconds), content);
}

describe('a content at the address the runtime signed for it', () => {
  it('is answered without a key, from any origin, with its bytes and its media type, kept privately for the seconds the address has left', async () => {
    const handler = servedAt(signedAt + 15, await holding());

    const answers = [
      await call(handler, addressOf(sha256)),
      await call(handler, addressOf(sha256), { headers: { origin: 'https://elsewhere.example' } }),
    ];

    expect(answers.map(({ status, text: body }) => [status, body])).toEqual([
      [200, text],
      [200, text],
    ]);
    expect(['content-type', 'content-length', 'cache-control'].map((name) => answers[0]?.headers.get(name))).toEqual([
      'application/json',
      String(text.length),
      'private, max-age=45',
    ]);
  });
});

describe('an address of a content the runtime refuses', () => {
  it('is refused as forbidden once the time it lasts until has passed, saying when it expired', async () => {
    const handler = servedAt(signedAt + 61, await holding());

    const answer = await call(handler, addressOf(sha256));

    expect(answer).toMatchObject({
      status: 403,
      body: {
        reason: 'forbidden',
        detail: `The address to this content expired at ${new Date((signedAt + 60) * 1000).toISOString()}; ask for a new one`,
      },
    });
  });

  it('is refused as forbidden where the address was signed for another content or the same content of another org, or carries no signature', async () => {
    const handler = servedAt(signedAt, await holding());
    const another = addressOf(sha256Of('another image'));

    const answers = [
      await call(handler, another.replace(sha256Of('another image'), sha256)),
      await call(handler, `/v1/orgs/acme/playbooks/alpha/content/${sha256}`),
      await call(handler, addressOf(sha256).replace('/orgs/acme/', '/orgs/globex/')),
    ];

    expect(answers.map(({ status, body }) => [status, body])).toMatchObject(
      Array.from({ length: 3 }, () => [
        403,
        { reason: 'forbidden', detail: 'The address is not one this runtime signed for this content' },
      ]),
    );
  });

  it('is not found where the playbook holds no content under the digest, though the address was signed for it, whether a range of it is asked or not', async () => {
    const handler = servedAt(signedAt, memoryRecordedContent());

    const answers = [
      await call(handler, addressOf(sha256)),
      await call(handler, addressOf(sha256), { headers: { range: 'bytes=0-4' } }),
    ];

    expect(answers).toMatchObject(
      Array.from({ length: 2 }, () => ({
        status: 404,
        body: { reason: 'not_found', detail: 'The playbook holds no content under this digest' },
      })),
    );
  });
});

describe('the route of the content of a playbook', () => {
  it('is answered to GET and HEAD alone, and leaves every other path of the playbook to a key', async () => {
    const handler = servedAt(signedAt, await holding());

    const [posted, deeper] = [
      await call(handler, addressOf(sha256), { method: 'POST' }),
      await call(handler, `/v1/orgs/acme/playbooks/alpha/content/${sha256}/more`),
    ];

    expect([posted.status, posted.headers.get('allow'), deeper.status]).toEqual([405, 'GET, HEAD', 401]);
  });
});

describe('the headers of a content at its address', () => {
  it('answers HEAD with the headers of the whole content and no body, a Range ignored as RFC 9110 has it, and cancels the stream the store opened for it', async () => {
    const whole = cancelledStream();
    const ranged = cancelledStream();
    const asked = { method: 'HEAD', headers: { range: 'bytes=2-5' } };

    const heads = [
      await call(servedAt(signedAt, streaming(whole.stream)), addressOf(sha256), { method: 'HEAD' }),
      await call(servedAt(signedAt, streaming(ranged.stream)), addressOf(sha256), asked),
    ];

    const headersOfTheWhole = { status: 200, body: '', type: 'image/png', length: '10', range: null, accepts: 'bytes' };
    expect(heads.map((head) => partOf(head))).toEqual([headersOfTheWhole, headersOfTheWhole]);
    expect(await Promise.all([whole.cancelled, ranged.cancelled])).toEqual(['cancelled', 'cancelled']);
  });

  it('counts the seconds an address has left before the store reads the content, and never fewer than none', async () => {
    const kept = await holding();
    const crossing = { at: (signedAt + 59) * 1000 };
    const readingASecond = readingInASecond(kept, () => {
      crossing.at += 1000;
    });
    const ticking = { at: (signedAt + 60) * 1000 - 100 };

    const answers = [
      await call(
        servedBy(() => crossing.at, readingASecond),
        addressOf(sha256),
      ),
      await call(
        servedBy(() => (ticking.at += 400), kept),
        addressOf(sha256),
      ),
    ];

    expect(answers.map(({ status, headers }) => [status, headers.get('cache-control')])).toEqual([
      [200, 'private, max-age=1'],
      [200, 'private, max-age=0'],
    ]);
  });
});

describe('the content at an address signed by a server whose clock is ahead', () => {
  it('is kept in a cache for 15 minutes at the most', async () => {
    const ahead = contentAddressesUnder(key, at(signedAt + 29));
    const address = pathOf(ahead.signedContentAddress('http://localhost', alpha, sha256, signedAt + 2000));

    const answer = await call(servedAt(signedAt, await holding()), address);

    expect([
      answer.status,
      address.includes(`until=${String(signedAt + 929)}`),
      answer.headers.get('cache-control'),
    ]).toEqual([200, true, 'private, max-age=900']);
  });
});

describe('the stream of a content at its address', () => {
  it('hands on the stream of the content as the store reads it, so a read that fails part way fails the answer', async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.error(new Error('The content kept under it is missing its chunk 1'));
      },
    });
    const handler = servedAt(signedAt, streaming(failing));

    const answered = call(handler, addressOf(sha256));

    await expect(answered).rejects.toThrow('The content kept under it is missing its chunk 1');
  });
});

function rangesOf(
  handler: ReturnType<typeof servedAt>,
  ranges: readonly string[],
): Promise<readonly Omit<Answer, 'body'>[]> {
  return Promise.all(
    ranges.map(async (range) => {
      const answer = await handler.fetch(new Request(`http://localhost${addressOf(sha256)}`, { headers: { range } }));
      return { status: answer.status, text: await answer.text(), headers: answer.headers };
    }),
  );
}

const answeredWhole = ['bytes=0-1,4-5', 'bytes=-5', 'bytes=5-3', 'items=0-1'];

describe('a range of the bytes of a content at its address', () => {
  it('is answered 206 with the bytes from its first to its last, or to the end, and the Content-Range and Content-Length of the part', async () => {
    const answers = await rangesOf(servedAt(signedAt, await holding()), ['bytes=0-4', 'bytes=10-', 'bytes=5-100']);

    const json = { status: 206, type: 'application/json', accepts: 'bytes' };
    expect(answers.map((answer) => partOf(answer))).toEqual([
      { ...json, body: text.slice(0, 5), length: '5', range: 'bytes 0-4/17' },
      { ...json, body: text.slice(10), length: '7', range: 'bytes 10-16/17' },
      { ...json, body: text.slice(5), length: '12', range: 'bytes 5-16/17' },
    ]);
  });

  it('is answered 416 range_not_satisfiable where it starts past the end, with the size the content holds', async () => {
    const past = await call(servedAt(signedAt, await holding()), addressOf(sha256), {
      headers: { range: 'bytes=17-' },
    });

    expect([past.status, past.headers.get('content-range'), past.headers.get('accept-ranges')]).toEqual([
      416,
      'bytes */17',
      'bytes',
    ]);
    expect(past.body).toMatchObject({
      reason: 'range_not_satisfiable',
      detail: 'The content holds 17 bytes, so the range asked starts past its end',
    });
  });

  it('is answered with the whole content, 200, where several ranges, a suffix, a range ending before it starts or other units are asked', async () => {
    const answers = await rangesOf(servedAt(signedAt, await holding()), answeredWhole);

    expect(answers.map(({ status, text: body, headers }) => [status, body, headers.get('accept-ranges')])).toEqual(
      Array.from({ length: 4 }, () => [200, text, 'bytes']),
    );
  });
});
