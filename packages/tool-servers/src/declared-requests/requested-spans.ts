import { Effect } from 'effect';

import type { DeclaredRequest, RequestedOnce } from './declared-requests.ts';

type Attributes = Readonly<Record<string, string | number>>;

function originOf(address: string): Attributes {
  const url = URL.parse(address);
  if (url === null) {
    return {};
  }
  const scheme = { 'url.scheme': url.protocol.slice(0, -1), 'server.address': url.hostname };
  return url.port === '' ? scheme : { ...scheme, 'server.port': Number(url.port) };
}

function endingOf(once: RequestedOnce): Readonly<Record<string, string>> {
  if (once.kind === 'unopened') {
    return { 'error.type': once.because };
  }
  return once.outcome === 'result' ? {} : { 'error.type': once.outcome };
}

export function tracedRequest(
  { method, url }: DeclaredRequest,
  requesting: Effect.Effect<RequestedOnce>,
): Effect.Effect<RequestedOnce> {
  return requesting.pipe(
    Effect.tap((once) => Effect.annotateCurrentSpan(endingOf(once))),
    Effect.withSpan(method, { kind: 'client', attributes: { 'http.request.method': method, ...originOf(url) } }),
  );
}
