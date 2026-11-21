import { Function } from 'effect';

import type { FailedRequest, FetchHandler, HeardRequest, LoopbackServer } from './fetch-handler.ts';

export type InProcessFetch = (...asked: readonly [unknown, unknown?]) => Promise<Response>;

export interface InProcessServer extends LoopbackServer {
  readonly fetch: InProcessFetch;
}

interface Records {
  readonly hear: (heard: HeardRequest) => void;
  readonly fail: (failed: FailedRequest) => void;
}

const answering = new Map<string, FetchHandler>();

const named = { served: 0 };

const inProcessHosts = '.in-process.test';

function heardOf(request: Readonly<Request>): HeardRequest {
  const { pathname, search } = new URL(request.url);
  return {
    method: request.method,
    path: `${pathname}${search}`,
    userAgent: request.headers.get('user-agent') ?? undefined,
    contentLength: request.headers.get('content-length') ?? undefined,
    transferEncoding: request.headers.get('transfer-encoding') ?? undefined,
  };
}

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

async function answered(
  handle: FetchHandler,
  request: Readonly<Request>,
  signal: Readonly<AbortSignal>,
): Promise<Response> {
  signal.throwIfAborted();
  const handling = handle(request);
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

function unanswered({ hostname }: Readonly<URL>): Promise<Response> {
  return Promise.reject(
    new TypeError('fetch failed', { cause: new Error(`Nothing is served in process at ${hostname}`) }),
  );
}

async function framed(request: Readonly<Request>, streamed: boolean): Promise<Request> {
  if (request.body === null) {
    return request;
  }
  const headers = new Headers(request.headers);
  if (streamed) {
    if (!headers.has('content-length')) {
      headers.set('transfer-encoding', 'chunked');
    }
    return new Request(request, { headers });
  }
  const body = await request.arrayBuffer();
  headers.set('content-length', String(body.byteLength));
  const { method, signal, redirect } = request;
  return new Request(request.url, { method, headers, body, signal, redirect });
}

export const inProcessFetch: InProcessFetch = async (...[input, init]: readonly [unknown, unknown?]) => {
  const request = new Request(input instanceof Request ? input : String(input), Object.assign({}, init));
  const url = new URL(request.url);
  const handle = answering.get(url.origin);
  if (handle !== undefined) {
    const given = Object.assign({}, init);
    const sent = await framed(request, Reflect.get(given, 'body') instanceof ReadableStream);
    const signal: unknown = Reflect.get(given, 'signal');
    return answered(handle, sent, signal instanceof AbortSignal ? signal : request.signal);
  }
  return url.hostname.endsWith(inProcessHosts) ? unanswered(url) : globalThis.fetch(request);
};

function recording(handle: FetchHandler, { hear, fail }: Records): FetchHandler {
  return async (request) => {
    const seen = heardOf(request);
    hear(seen);
    try {
      return await handle(request);
    } catch (error) {
      const failed = { method: seen.method, path: seen.path, error: String(error) };
      fail(failed);
      return new Response(failed.error, { status: 500 });
    }
  };
}

export function serveInProcess(handlerAt: (origin: string) => FetchHandler, name = 'fake'): InProcessServer {
  named.served += 1;
  const origin = `https://${name}-${named.served}${inProcessHosts}`;
  const heard: HeardRequest[] = [];
  const failures: FailedRequest[] = [];
  const records: Records = {
    hear: (seen) => {
      heard.push(seen);
    },
    fail: (failed) => {
      failures.push(failed);
    },
  };
  answering.set(origin, recording(handlerAt(origin), records));
  return {
    origin,
    fetch: inProcessFetch,
    heard: () => [...heard],
    failures: () => [...failures],
    close: () => {
      answering.delete(origin);
      return Promise.resolve();
    },
  };
}
