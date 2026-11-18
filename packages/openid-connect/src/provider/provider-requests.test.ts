import { once } from 'node:events';
import { createServer } from 'node:http';

import { Predicate, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  answerAt,
  boundedFetchOf,
  mostAnswerBytes,
  providerRequestsOverTheNetwork,
  UnreadAnswer,
  type ProviderRequests,
} from './provider-requests.ts';

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const server = createServer((request, response) => {
  if (request.url === '/moved') {
    response.writeHead(302, { location: 'http://127.0.0.1/elsewhere' });
    response.end();
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ method: request.method }));
});

afterEach(() => {
  server.close();
});

const address = 'https://login.example.com/tenant/v2.0/.well-known/openid-configuration';

const aRead = { headers: { accept: 'application/json' }, method: 'GET' } as const;

function answering(answer: () => Promise<Response>): ProviderRequests {
  return { fetch: answer };
}

function answered(answer: Response): ProviderRequests {
  return answering(() => Promise.resolve(answer));
}

function failureOf(read: unknown): string | undefined {
  return Predicate.hasProperty(read, 'failure') ? String(read.failure) : undefined;
}

function textOf(read: unknown): Promise<string | undefined> {
  return Predicate.hasProperty(read, 'success') && read.success instanceof Response
    ? read.success.text()
    : Promise.resolve(failureOf(read));
}

describe('the requests to the identity provider over the network', () => {
  it('go with the fetch of the platform, and follow no redirect', async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${portOf(server.address()).port}`;

    const read = await answerAt(providerRequestsOverTheNetwork, `${origin}/metadata`, aRead);
    const moved = await answerAt(providerRequestsOverTheNetwork, `${origin}/moved`, aRead);
    const answeredMoved = await answerAt(answered(Response.redirect(`${origin}/`, 302)), address, aRead);

    expect(await textOf(read)).toBe('{"method":"GET"}');
    expect([Result.isFailure(moved), failureOf(moved)]).toEqual([true, failureOf(answeredMoved)]);
  });
});

describe('the requests to the identity provider', () => {
  it('take an answer of at most 64 KiB, and refuse a longer one', async () => {
    const atMost = await answerAt(answered(new Response('a'.repeat(mostAnswerBytes))), address, aRead);
    const longer = await answerAt(answered(new Response('a'.repeat(mostAnswerBytes + 1))), address, aRead);
    const empty = await answerAt(answered(new Response(null, { status: 204 })), address, aRead);

    expect((await textOf(atMost))?.length).toBe(mostAnswerBytes);
    expect([Result.isSuccess(empty), Result.isFailure(longer)]).toEqual([true, true]);
  });

  it('say whether the provider could not be reached or did not answer in time', async () => {
    const unreached = await answerAt(
      answering(() => Promise.reject(new TypeError('fetch failed'))),
      address,
      aRead,
    );
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const late = await answerAt(
      answering(() => Promise.reject(timeout)),
      address,
      aRead,
    );

    expect([Result.isFailure(unreached), Result.isFailure(late)]).toEqual([true, true]);
    expect(failureOf(unreached)).not.toBe(failureOf(late));
  });

  it('end at the signal the library gives, and throw what could not be read for the library to wrap', async () => {
    const seen: AbortSignal[] = [];
    const library = new AbortController();
    const bounded = boundedFetchOf({
      fetch: (request) => {
        seen.push(request.signal);
        return Promise.resolve(new Response('{}'));
      },
    });
    const refused = boundedFetchOf(answering(() => Promise.reject(new TypeError('fetch failed'))));

    await bounded(address, { body: undefined, headers: {}, method: 'GET', redirect: 'manual', signal: library.signal });
    library.abort();

    expect(seen.map((signal) => signal.aborted)).toEqual([true]);
    await expect(
      refused(address, { body: 'a=b', headers: {}, method: 'POST', redirect: 'manual' }),
    ).rejects.toBeInstanceOf(UnreadAnswer);
  });
});
