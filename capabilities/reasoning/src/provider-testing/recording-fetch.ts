import { Predicate } from 'effect';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly signal: Readonly<AbortSignal>;
}

export type Responder = (request: RecordedRequest, attempt: number) => Response | Promise<Response>;

export interface RecordingFetch {
  readonly fetch: (input: unknown, init?: unknown) => Promise<Response>;
  readonly requests: () => readonly RecordedRequest[];
}

function headersOf(init: unknown): Readonly<Record<string, string>> {
  const headers = Predicate.hasProperty(init, 'headers') ? init.headers : undefined;
  if (!Predicate.isObject(headers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]: readonly [string, unknown]) =>
      typeof value === 'string' ? [[name.toLowerCase(), value]] : [],
    ),
  );
}

function bodyOf(init: unknown): unknown {
  const body = Predicate.hasProperty(init, 'body') ? init.body : undefined;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

function signalOf(init: unknown): Readonly<AbortSignal> {
  const signal = Predicate.hasProperty(init, 'signal') ? init.signal : undefined;
  return signal instanceof AbortSignal ? signal : new AbortController().signal;
}

function methodOf(init: unknown): string {
  return Predicate.hasProperty(init, 'method') && typeof init.method === 'string' ? init.method : 'GET';
}

export function recordingFetch(responder: Responder): RecordingFetch {
  const recorded: RecordedRequest[] = [];
  return {
    fetch: (input, init) => {
      const request: RecordedRequest = {
        url: String(input),
        method: methodOf(init),
        headers: headersOf(init),
        body: bodyOf(init),
        signal: signalOf(init),
      };
      recorded.push(request);
      return Promise.resolve(responder(request, recorded.length));
    },
    requests: () => [...recorded],
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function abortedWith(signal: Readonly<AbortSignal>): Promise<Response> {
  return new Promise((_resolve, reject: (reason: Readonly<Error>) => void) => {
    const rejectAsAborted = (): void => {
      reject(new DOMException('The request was aborted', 'AbortError'));
    };
    if (signal.aborted) {
      rejectAsAborted();
    } else {
      signal.addEventListener('abort', rejectAsAborted);
    }
  });
}

export function connectionFailure(code: string): Promise<Response> {
  const cause = Object.assign(new Error(`connect failed with ${code}`), { code });
  return Promise.reject(new TypeError('fetch failed', { cause }));
}
