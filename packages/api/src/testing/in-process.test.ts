import { describe, expect, it, onTestFinished } from 'vitest';

import type { ApiHandler } from '../index.ts';
import { fetchInProcess, listenInProcess } from './in-process.ts';

function served(answer: (request: Request) => Promise<Response>) {
  const handler: ApiHandler = { fetch: answer, listener: () => Promise.resolve(), close: () => Promise.resolve() };
  const listening = listenInProcess(handler);
  onTestFinished(listening.close);
  return listening;
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

describe('an API handler served in process', () => {
  it('answers a request sent to its origin, given as an address or as a request, and nothing once closed', async () => {
    const listening = served(async (request) => new Response(`${request.method} ${await request.text()}`));

    const asked = await fetchInProcess(`${listening.origin}/echo`, { method: 'POST', body: 'hi' });
    const given = await fetchInProcess(new Request(`${listening.origin}/echo`));
    await listening.close();

    expect([await asked.text(), given.status, await given.text()]).toEqual(['POST hi', 200, 'GET ']);
    await expect(fetchInProcess(`${listening.origin}/echo`)).rejects.toThrow(TypeError);
  });

  it('passes a request to any other origin on to the fetch of the platform', async () => {
    const answer = await fetchInProcess('data:text/plain,elsewhere');

    expect(await answer.text()).toBe('elsewhere');
  });
});

describe('a request to an API handler in process that its sender gives up on', () => {
  it('is never handled when it was given up before it was sent', async () => {
    const heard: string[] = [];
    const listening = served((request) => {
      heard.push(request.url);
      return Promise.resolve(new Response('late'));
    });
    const reason = new Error('given up');

    await expect(fetchInProcess(`${listening.origin}/`, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(heard).toEqual([]);
  });

  it('fails with the reason while its handler has not answered, and cancels the body it answers late', async () => {
    const late = Promise.withResolvers<Response>();
    const handled = Promise.withResolvers<void>();
    const listening = served(() => {
      handled.resolve();
      return late.promise;
    });
    const sending = new AbortController();
    const reason = new Error('given up');
    const { response, cancelled } = endlessBody();

    const answer = fetchInProcess(`${listening.origin}/`, { signal: sending.signal });
    await handled.promise;
    sending.abort(reason);
    await expect(answer).rejects.toBe(reason);
    late.resolve(response);

    await expect(cancelled).resolves.toBe(reason);
  });
});

describe('an answer from an API handler in process that its sender gives up on', () => {
  it('fails its body with the reason and cancels the body its handler gave when given up in the middle of it', async () => {
    const { response, cancelled } = endlessBody();
    const listening = served(() => Promise.resolve(response));
    const sending = new AbortController();
    const reason = new Error('given up');

    const answer = await fetchInProcess(`${listening.origin}/`, { signal: sending.signal });
    const reader = answer.body?.getReader();
    const first = await reader?.read();
    const pending = reader?.read();
    sending.abort(reason);

    expect(first).toEqual({ done: false, value: new TextEncoder().encode('first') });
    await expect(pending).rejects.toBe(reason);
    await expect(cancelled).resolves.toBe(reason);
  });

  it('cancels the body its handler gave when the sender cancels the body it read, and ends one that ends', async () => {
    const { response, cancelled } = endlessBody();
    const endless = served(() => Promise.resolve(response));
    const ending = served(() => Promise.resolve(new Response('whole')));

    const answer = await fetchInProcess(`${endless.origin}/`);
    await answer.body?.cancel('enough');
    const whole = await (await fetchInProcess(`${ending.origin}/`, { signal: new AbortController().signal })).text();

    await expect(cancelled).resolves.toBe('enough');
    expect(whole).toBe('whole');
  });
});
