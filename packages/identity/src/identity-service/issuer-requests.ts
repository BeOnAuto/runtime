import { Data, Predicate, Result } from 'effect';
import type { FetchImplementation } from 'jose';

export type IssuerFetch = (request: Readonly<Request>) => Promise<Response>;

export interface IssuerRequests {
  readonly fetch: IssuerFetch;
  readonly now: () => number;
}

export const issuerRequestsOverTheNetwork: IssuerRequests = { fetch: (request) => fetch(request), now: Date.now };

export const issuerAnswerMs = 10_000;

export class UnreadAnswer extends Data.TaggedError('UnreadAnswer')<{ readonly message: string }> {}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

async function bytesUpTo(body: ReadableStream<Uint8Array> | null, mostBytes: number): Promise<Buffer | undefined> {
  if (body === null) {
    return Buffer.alloc(0);
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > mostBytes) {
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const redirected = 'answers a redirect, which the runtime does not follow';

function isRefusedRedirect(error: unknown): boolean {
  return (
    Predicate.hasProperty(error, 'cause') &&
    Predicate.hasProperty(error.cause, 'message') &&
    error.cause.message === 'unexpected redirect'
  );
}

function unreached(error: unknown): string {
  if (isRefusedRedirect(error)) {
    return redirected;
  }
  return Predicate.hasProperty(error, 'name') && error.name === 'TimeoutError'
    ? `does not answer within ${issuerAnswerMs / 1000} seconds`
    : 'cannot be reached';
}

function isRedirect({ status }: Readonly<Response>): boolean {
  return status >= 300 && status < 400;
}

type Body = Readonly<Uint8Array>;

function jsonIn(bytes: Body): Result.Result<unknown, string> {
  return Result.try({ try: (): unknown => JSON.parse(utf8.decode(bytes)), catch: () => 'answers no JSON' });
}

async function bodyOf(response: Readonly<Response>, mostBytes: number): Promise<Result.Result<Body, string>> {
  if (!response.ok) {
    await response.body?.cancel();
    return Result.fail(isRedirect(response) ? redirected : `answers ${response.status}`);
  }
  const bytes = await bytesUpTo(response.body, mostBytes);
  return bytes === undefined ? Result.fail(`answers more than ${mostBytes / 1024} KiB`) : Result.succeed(bytes);
}

async function bodyAt(
  { fetch }: IssuerRequests,
  request: Readonly<Request>,
  mostBytes: number,
): Promise<Result.Result<Body, string>> {
  try {
    return await bodyOf(await fetch(request), mostBytes);
  } catch (error) {
    return Result.fail(unreached(error));
  }
}

export async function jsonAt(
  requests: IssuerRequests,
  address: string,
  mostBytes: number,
): Promise<Result.Result<unknown, string>> {
  const request = new Request(address, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(issuerAnswerMs),
  });
  const body = await bodyAt(requests, request, mostBytes);
  return Result.isSuccess(body) ? jsonIn(body.success) : Result.fail(body.failure);
}

interface KeySetRequest {
  readonly headers: Readonly<Headers>;
  readonly redirect: 'manual';
  readonly signal: Readonly<AbortSignal>;
}

export function boundedFetchOf(requests: IssuerRequests, mostBytes: number): FetchImplementation {
  return async (url: string, { headers, redirect, signal }: KeySetRequest) => {
    const read = await bodyAt(requests, new Request(url, { headers, redirect, signal }), mostBytes);
    if (Result.isFailure(read)) {
      throw new UnreadAnswer({ message: read.failure });
    }
    return new Response(new Uint8Array(read.success), { headers: { 'content-type': 'application/json' } });
  };
}
