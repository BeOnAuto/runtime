import { Predicate } from 'effect';

type OutboundFetch = (url: unknown, init?: unknown) => Promise<Response>;

type HeadersInit = NonNullable<ConstructorParameters<typeof Headers>[0]>;

function isHeaderPair(written: unknown): written is [string, string] {
  return Array.isArray(written) && written.length === 2 && written.every((part) => typeof part === 'string');
}

function isHeaderRecord(written: unknown): written is Readonly<Record<string, string>> {
  return Predicate.isObject(written) && Object.values(written).every((value) => typeof value === 'string');
}

function isHeadersInit(written: unknown): written is HeadersInit {
  return (
    written instanceof Headers ||
    (Array.isArray(written) && written.every((pair) => isHeaderPair(pair))) ||
    isHeaderRecord(written)
  );
}

function headersOf(init: unknown): Headers | undefined {
  const written: unknown = Predicate.hasProperty(init, 'headers') ? init.headers : undefined;
  if (written === undefined) {
    return new Headers();
  }
  return isHeadersInit(written) ? new Headers(written) : undefined;
}

export function withUserAgent(fetch: typeof globalThis.fetch, userAgent: string): OutboundFetch {
  return (url, init) => {
    const headers = headersOf(init);
    if (headers !== undefined && !headers.has('user-agent')) {
      headers.set('user-agent', userAgent);
    }
    return fetch(String(url), Object.assign({}, init, headers === undefined ? {} : { headers }));
  };
}
