import type { FetchOfACall } from '@on.auto/operations';
import { fetchWithin, type Reaches } from '@on.auto/outbound';
import { Redacted } from 'effect';

import { failureOf, isCredentialRefused } from '../clients/server-failures.ts';
import { brokenOrAsIs, type CredentialRefused } from '../clients/server-links.ts';
import { settledWithOneNewToken } from '../openapi/api-client.ts';
import { failedBecause } from '../org-servers/server-refusals.ts';
import { mayCarryTo, type Bearer } from './carried-credentials.ts';
import type { DeclaredRequest, RequestedOnce, Unopened } from './declared-requests.ts';
import { settledRequestOf, type RequestSettled } from './requested-answers.ts';

export interface BearerSending {
  readonly origins: readonly string[];
  readonly bearer: Bearer | undefined;
  readonly fetch: FetchOfACall;
  readonly reaches: Reaches;
  readonly refused?: CredentialRefused;
  readonly callMs: number;
  readonly mostRequestBytes: number;
}

interface Carrying {
  readonly url: Readonly<URL>;
  readonly bearer: Bearer;
}

interface Within {
  readonly send: (url: string, init: unknown) => Promise<Response>;
  readonly sent: () => boolean;
}

interface Attempt {
  readonly request: DeclaredRequest;
  readonly carrying: Carrying;
  readonly body: string | undefined;
  readonly within: Within;
  readonly signal: Readonly<AbortSignal>;
}

class LargerThanItsBound extends Error {}

const timedOut: RequestedOnce = { kind: 'answered', outcome: 'timed_out' };

function unopened(because: Unopened['because']): Unopened {
  return { kind: 'unopened', because };
}

function declaredUrlOf(address: string, origins: readonly string[]): Readonly<URL> | undefined {
  const url = URL.parse(address);
  const isDeclared =
    url !== null &&
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    origins.includes(url.origin);
  return isDeclared ? url : undefined;
}

function carryingOf({ url }: DeclaredRequest, { origins, bearer }: BearerSending): Carrying | Unopened {
  const declared = declaredUrlOf(url, origins);
  if (declared === undefined || bearer === undefined) {
    return unopened('connection_not_allowed');
  }
  return mayCarryTo(bearer, declared) ? { url: declared, bearer } : unopened('scope_lacking');
}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function withinOf({ fetch, reaches, mostRequestBytes }: BearerSending, body: string | undefined): Within {
  const tooLarge = body !== undefined && bytesOf(body) > mostRequestBytes;
  let sends = 0;
  const send = fetchWithin((...[address, init]: readonly [string, unknown?]) => {
    if (tooLarge) {
      throw new LargerThanItsBound();
    }
    sends += 1;
    return fetch(address, Object.assign({}, init));
  }, reaches);
  return { send, sent: () => sends > 0 };
}

function keyOf(bearer: Bearer): Readonly<Record<string, string>> {
  return bearer.kind === 'key' ? { authorization: `Bearer ${Redacted.value(bearer.token)}` } : {};
}

function headersOf({ body, carrying }: Attempt, authorization: Readonly<Record<string, string>>) {
  return {
    accept: 'application/json',
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...keyOf(carrying.bearer),
    ...authorization,
  };
}

function settledThrough(attempt: Attempt, sending: BearerSending): Promise<RequestSettled> {
  const { request, carrying, body, within, signal } = attempt;
  const { bearer, url } = carrying;
  return settledWithOneNewToken(
    bearer.kind === 'token' ? bearer.tokens : undefined,
    async (authorization) => {
      const headers = headersOf(attempt, authorization);
      const sent = { method: request.method, headers, signal, ...(body === undefined ? {} : { body }) };
      const response = await within.send(url.href, sent);
      return { response, settled: await settledRequestOf(response) };
    },
    (settled) => 'error' in settled && isCredentialRefused(settled.error),
    { serverUrl: url, fetchFn: fetchWithin(sending.fetch, sending.reaches) },
  );
}

async function answeredOf(settled: RequestSettled, refused: CredentialRefused | undefined): Promise<RequestedOnce> {
  if (!('error' in settled)) {
    return { kind: 'answered', ...settled };
  }
  const failure = refused === undefined ? settled.error : await brokenOrAsIs(refused, settled.error);
  return { kind: 'answered', outcome: 'server_failure', because: failedBecause[failureOf(failure).kind] };
}

function failedOf(error: unknown, { within }: Attempt, deadline: Readonly<AbortSignal>): RequestedOnce {
  if (error instanceof LargerThanItsBound) {
    return unopened('too_large');
  }
  const because = failedBecause[failureOf(error).kind];
  if (!within.sent()) {
    return unopened(because);
  }
  return deadline.aborted ? timedOut : { kind: 'answered', outcome: 'server_failure', because };
}

export async function requestedWith(
  request: DeclaredRequest,
  sending: BearerSending,
  signal: Readonly<AbortSignal>,
): Promise<RequestedOnce> {
  const carrying = carryingOf(request, sending);
  if ('kind' in carrying) {
    return carrying;
  }
  const body = request.body === undefined ? undefined : JSON.stringify(request.body);
  const deadline = AbortSignal.timeout(sending.callMs);
  const attempt = {
    request,
    carrying,
    body,
    within: withinOf(sending, body),
    signal: AbortSignal.any([signal, deadline]),
  };
  try {
    const settled = await settledThrough(attempt, sending);
    return 'error' in settled && deadline.aborted ? timedOut : await answeredOf(settled, sending.refused);
  } catch (error) {
    return failedOf(error, attempt, deadline);
  }
}
