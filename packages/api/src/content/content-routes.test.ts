import { sha256Of, textToKeep, type RecordedContent } from '@on.auto/content';
import { memoryRecordedContent } from '@on.auto/content/testing';
import { authenticatorFor, contentAddressesUnder } from '@on.auto/identity';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { contentAddressRoutes } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';
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

function servedBy(now: () => number, content: Pick<RecordedContent, 'get'>) {
  return createTestHandler({
    authenticator: authenticatorFor({ host: '0.0.0.0', apiKeys: [acmeAdmin.entry] }),
    routes: [contentAddressRoutes({ key, content, now })],
  }).handler;
}

function readingInASecond(kept: RecordedContent, aSecondPasses: () => void): Pick<RecordedContent, 'get'> {
  return { get: (playbook, digest) => Effect.andThen(Effect.sync(aSecondPasses), kept.get(playbook, digest)) };
}

function servedAt(seconds: number, content: Pick<RecordedContent, 'get'>) {
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

  it('is not found where the playbook holds no content under the digest, though the address was signed for it', async () => {
    const handler = servedAt(signedAt, memoryRecordedContent());

    const answer = await call(handler, addressOf(sha256));

    expect(answer).toMatchObject({
      status: 404,
      body: { reason: 'not_found', detail: 'The playbook holds no content under this digest' },
    });
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
  it('answers HEAD with the headers of the content and no body, and cancels the stream the store opened for it', async () => {
    const cancelled = Promise.withResolvers<string>();
    const opened = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled.resolve('cancelled');
      },
    });
    const handler = servedAt(signedAt, {
      get: () => Effect.succeed({ stream: opened, bytes: 10, mediaType: 'image/png' }),
    });

    const head = await call(handler, addressOf(sha256), { method: 'HEAD' });

    expect([head.status, head.text, head.headers.get('content-type'), head.headers.get('content-length')]).toEqual([
      200,
      '',
      'image/png',
      '10',
    ]);
    expect(await cancelled.promise).toBe('cancelled');
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
    const handler = servedAt(signedAt, {
      get: () => Effect.succeed({ stream: failing, bytes: 10, mediaType: 'image/png' }),
    });

    const answered = call(handler, addressOf(sha256));

    await expect(answered).rejects.toThrow('The content kept under it is missing its chunk 1');
  });
});
