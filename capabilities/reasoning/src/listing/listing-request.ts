import { Effect, Option, Predicate, Result, Schema } from 'effect';

import { OutboundFailure } from '../providers/outbound-failure.ts';
import type { Fetch } from '../providers/sdk-model.ts';
import type { ListedModel } from './listed-model.ts';

const listingTimeoutMs = 10_000;

const mostListingBytes = 8_388_608;

const mostErrorBytes = 65_536;

const mostPages = 10;

export type ListingProblem =
  | { readonly kind: 'answered'; readonly status: number; readonly message: string }
  | { readonly kind: 'unread'; readonly reason: string };

export interface ListingRequest {
  readonly fetch: Fetch;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ProviderListing {
  readonly read: Effect.Effect<readonly ListedModel[], ListingProblem>;
}

export interface ListedSource extends ProviderListing {
  readonly kind: 'listed';
  readonly provider: string;
  readonly fallback: readonly ListedModel[];
}

export interface ListingPage {
  readonly models: readonly ListedModel[];
  readonly next: string | undefined;
}

interface Answer {
  readonly status: number;
  readonly ok: boolean;
  readonly text: string | undefined;
}

export function endpointUrl(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl}${path}`);
}

function unread(reason: string): ListingProblem {
  return { kind: 'unread', reason };
}

function sendingFailure(error: unknown): ListingProblem {
  if (error instanceof OutboundFailure && error.reason === 'untrusted_certificate') {
    return unread('its TLS certificate is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS');
  }
  return Predicate.hasProperty(error, 'name') && error.name === 'TimeoutError'
    ? unread(`it did not answer within ${listingTimeoutMs / 1000} seconds`)
    : unread('it could not be reached');
}

async function textUpTo(body: ReadableStream<Uint8Array>, mostBytes: number): Promise<string | undefined> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > mostBytes) {
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function answerOf(request: ListingRequest, signal: Readonly<AbortSignal>): Promise<Answer> {
  const response = await request.fetch(request.url, {
    method: 'GET',
    headers: { ...request.headers },
    signal: AbortSignal.any([signal, AbortSignal.timeout(listingTimeoutMs)]),
  });
  const body = response.body ?? new Blob().stream();
  const text = await textUpTo(body, response.ok ? mostListingBytes : mostErrorBytes);
  return { status: response.status, ok: response.ok, text };
}

function parsed(text: string): Result.Result<unknown, ListingProblem> {
  try {
    const value: unknown = JSON.parse(text);
    return Result.succeed(value);
  } catch {
    return Result.fail(unread('its answer is not JSON'));
  }
}

function errorMessageOf(text: string | undefined): string {
  if (text === undefined) {
    return `The answer was larger than ${mostErrorBytes / 1024} KiB`;
  }
  return text.trim() === '' ? 'The answer had no message' : text.trim();
}

function jsonOf({ status, ok, text }: Answer): Result.Result<unknown, ListingProblem> {
  if (!ok) {
    return Result.fail({ kind: 'answered', status, message: errorMessageOf(text) });
  }
  return text === undefined
    ? Result.fail(unread(`its answer is larger than ${mostListingBytes / 1_048_576} MiB`))
    : parsed(text);
}

export function listingJson(request: ListingRequest): Effect.Effect<unknown, ListingProblem> {
  return Effect.tryPromise({
    try: (signal) => answerOf(request, signal),
    catch: (error) => sendingFailure(error),
  }).pipe(Effect.flatMap((answer) => Effect.fromResult(jsonOf(answer))));
}

export function decodedAs<S extends Schema.Decoder<unknown>>(
  schema: S,
): (json: unknown) => Effect.Effect<S['Type'], ListingProblem> {
  const decode = Schema.decodeUnknownResult(schema);
  return (json) => Effect.fromResult(Result.mapError(decode(json), () => unread('its answer is not a list of models')));
}

export function wellFormedEntries<S extends Schema.Decoder<unknown>>(
  schema: S,
): (entries: readonly unknown[]) => readonly S['Type'][] {
  const decode = Schema.decodeUnknownOption(schema);
  return (entries) => entries.flatMap((entry) => Option.toArray(decode(entry)));
}

function pagesFrom(
  readPage: (cursor: string | undefined) => Effect.Effect<ListingPage, ListingProblem>,
  cursor: string | undefined,
  pagesLeft: number,
): Effect.Effect<readonly ListedModel[], ListingProblem> {
  return Effect.flatMap(readPage(cursor), ({ models, next }) => {
    if (next === undefined) {
      return Effect.succeed(models);
    }
    return pagesLeft <= 1
      ? Effect.fail(unread(`it has more than ${mostPages} pages of models`))
      : Effect.map(pagesFrom(readPage, next, pagesLeft - 1), (rest) => [...models, ...rest]);
  });
}

export function everyPage(
  readPage: (cursor: string | undefined) => Effect.Effect<ListingPage, ListingProblem>,
): Effect.Effect<readonly ListedModel[], ListingProblem> {
  return pagesFrom(readPage, undefined, mostPages);
}
