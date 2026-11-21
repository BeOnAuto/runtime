import { Function } from 'effect';

import type { ApiHandler } from '../index.ts';
import type { Listening } from './listening.ts';

const answering = new Map<string, ApiHandler>();

const named = { served: 0 };

const inProcessHosts = '.in-process.test';

function whenAborted(signal: Readonly<AbortSignal>): Promise<Response> {
  const aborted = Promise.withResolvers<Response>();
  signal.addEventListener(
    'abort',
    () => {
      aborted.resolve(Response.error());
    },
    { once: true },
  );
  return aborted.promise;
}

function cutBy(signal: Readonly<AbortSignal>, body: Readonly<ReadableStream<Uint8Array>>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      signal.addEventListener(
        'abort',
        () => {
          controller.error(signal.reason);
          void reader.cancel(signal.reason).then(Function.constVoid, Function.constVoid);
        },
        { once: true },
      );
    },
    pull: async (controller) => {
      const { done, value } = await reader.read();
      if (signal.aborted) {
        return;
      }
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel: (reason: unknown) => reader.cancel(reason),
  });
}

async function answered(handler: ApiHandler, request: Request, signal: Readonly<AbortSignal>): Promise<Response> {
  signal.throwIfAborted();
  const handling = handler.fetch(request);
  const response = await Promise.race([handling, whenAborted(signal)]);
  if (signal.aborted) {
    void handling.then((late) => late.body?.cancel(signal.reason)).then(Function.constVoid, Function.constVoid);
  }
  signal.throwIfAborted();
  return response.body === null
    ? response
    : new Response(cutBy(signal, response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
}

export function fetchInProcess(...[input, init]: readonly [unknown, unknown?]): Promise<Response> {
  const given = Object.assign({}, init);
  const request = new Request(input instanceof Request ? input : String(input), given);
  const url = new URL(request.url);
  const handler = answering.get(url.origin);
  if (handler === undefined) {
    return url.hostname.endsWith(inProcessHosts)
      ? Promise.reject(new TypeError('fetch failed'))
      : globalThis.fetch(request);
  }
  const signal: unknown = Reflect.get(given, 'signal');
  return answered(handler, request, signal instanceof AbortSignal ? signal : request.signal);
}

export function servedInProcess(origin: string): boolean {
  return answering.has(origin);
}

export function listenInProcess(handler: ApiHandler): Listening {
  named.served += 1;
  const origin = `https://api-${named.served}${inProcessHosts}`;
  answering.set(origin, handler);
  return {
    origin,
    close: async () => {
      answering.delete(origin);
      await handler.close();
    },
  };
}
