import { afterEach, describe, expect, it } from 'vitest';

import { inProcessFetch, serveInProcess } from './in-process.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function served(handle: (request: Readonly<Request>) => Promise<Response>) {
  const server = serveInProcess(() => handle);
  closing.push(server.close);
  return server;
}

function endlessBody(): { readonly response: Response; readonly cancelled: Promise<unknown> } {
  const cancelled = Promise.withResolvers<unknown>();
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode('first'));
    },
    cancel: (reason: unknown) => {
      cancelled.resolve(reason);
    },
  });
  return { response: new Response(body), cancelled: cancelled.promise };
}

describe('a server in process', () => {
  it('answers a request sent to its origin as its handler answers it, and hears what was sent', async () => {
    const server = served(async (request) => Response.json({ got: await request.text() }, { status: 201 }));

    const answer = await server.fetch(`${server.origin}/v1/notes?page=2`, {
      method: 'POST',
      headers: { 'user-agent': 'auto-test', 'content-length': '2', 'transfer-encoding': 'chunked' },
      body: 'hi',
    });

    expect([answer.status, await answer.json()]).toEqual([201, { got: 'hi' }]);
    expect(server.heard()).toEqual([
      {
        method: 'POST',
        path: '/v1/notes?page=2',
        userAgent: 'auto-test',
        contentLength: '2',
        transferEncoding: 'chunked',
      },
    ]);
  });

  it('hears a request with none of those headers as having none, and answers one without a body', async () => {
    const server = served(() => Promise.resolve(new Response(null, { status: 204 })));

    const answer = await inProcessFetch(new Request(`${server.origin}/`));

    expect([answer.status, answer.body]).toEqual([204, null]);
    expect(server.heard()).toEqual([
      { method: 'GET', path: '/', userAgent: undefined, contentLength: undefined, transferEncoding: undefined },
    ]);
  });
});

function streamed(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode('hello'));
      controller.close();
    },
  });
}

describe('the framing of a body sent to a server in process, as the platform frames it', () => {
  it('counts a body given whole, sends one streamed without a length in chunks, and one streamed with a length as it is', async () => {
    const server = served(async (request) => new Response(await request.text()));

    await server.fetch(`${server.origin}/whole`, { method: 'POST', body: 'hello' });
    await server.fetch(`${server.origin}/chunked`, { method: 'POST', body: streamed(), duplex: 'half' });
    await server.fetch(`${server.origin}/counted`, {
      method: 'POST',
      body: streamed(),
      duplex: 'half',
      headers: { 'content-length': '5' },
    });

    expect(server.heard().map(({ contentLength, transferEncoding }) => [contentLength, transferEncoding])).toEqual([
      ['5', undefined],
      [undefined, 'chunked'],
      ['5', undefined],
    ]);
  });
});

describe('a server in process that does not answer', () => {
  it('answers 500 and records the failure when its handler throws, as a loopback server does', async () => {
    const server = served(() => Promise.reject(new Error('the handler broke')));

    const answer = await server.fetch(`${server.origin}/mcp`, { method: 'POST', body: '{}' });

    expect(answer.status).toBe(500);
    expect(server.failures()).toEqual([{ method: 'POST', path: '/mcp', error: 'Error: the handler broke' }]);
  });

  it('is gone once closed, so a request to its origin goes on to the network', async () => {
    const server = served(() => Promise.resolve(new Response('here')));
    await server.close();

    await expect(server.fetch(`${server.origin}/`)).rejects.toThrow(TypeError);
  });

  it('passes a request to any other origin on to the fetch of the platform', async () => {
    const answer = await inProcessFetch('data:text/plain,elsewhere');

    expect(await answer.text()).toBe('elsewhere');
  });
});

describe('a request to a server in process that its sender gives up on', () => {
  it('is never handled when it was given up before it was sent', async () => {
    const server = served(() => Promise.resolve(new Response('late')));
    const reason = new Error('given up');

    await expect(server.fetch(`${server.origin}/`, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(server.heard()).toEqual([]);
  });

  it('fails with the reason it was given up for while its handler has not answered, and cancels the body it answers late', async () => {
    const late = Promise.withResolvers<Response>();
    const handled = Promise.withResolvers<void>();
    const server = served(() => {
      handled.resolve();
      return late.promise;
    });
    const sending = new AbortController();
    const reason = new Error('given up');
    const { response, cancelled } = endlessBody();

    const answer = server.fetch(`${server.origin}/`, { signal: sending.signal });
    await handled.promise;
    sending.abort(reason);
    await expect(answer).rejects.toBe(reason);
    late.resolve(response);

    await expect(cancelled).resolves.toBe(reason);
  });
});

describe('an answer from a server in process that its sender gives up on', () => {
  it('fails its body with that reason and cancels the body its handler gave when given up in the middle of it', async () => {
    const { response, cancelled } = endlessBody();
    const server = served(() => Promise.resolve(response));
    const sending = new AbortController();
    const reason = new Error('given up');

    const answer = await server.fetch(`${server.origin}/`, { signal: sending.signal });
    const reader = answer.body?.getReader();
    const first = await reader?.read();
    const pending = reader?.read();
    sending.abort(reason);

    expect(first).toEqual({ done: false, value: new TextEncoder().encode('first') });
    await expect(pending).rejects.toBe(reason);
    await expect(cancelled).resolves.toBe(reason);
  });

  it('cancels the body its handler gave when the sender cancels the body it read', async () => {
    const { response, cancelled } = endlessBody();
    const server = served(() => Promise.resolve(response));

    const answer = await server.fetch(`${server.origin}/`);
    await answer.body?.cancel('enough');

    await expect(cancelled).resolves.toBe('enough');
  });
});
