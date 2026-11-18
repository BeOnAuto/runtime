import { Data, Predicate, Result } from 'effect';
import type { CustomFetch, FetchBody } from 'openid-client';

export type ProviderFetch = (request: Readonly<Request>) => Promise<Response>;

export interface ProviderRequests {
  readonly fetch: ProviderFetch;
}

export const providerRequestsOverTheNetwork: ProviderRequests = { fetch: (request) => fetch(request) };

export const providerAnswerSeconds = 10;

export const mostAnswerBytes = 65_536;

export class UnreadAnswer extends Data.TaggedError('UnreadAnswer')<{ readonly message: string }> {}

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
    ? `does not answer within ${providerAnswerSeconds} seconds`
    : 'cannot be reached';
}

async function bytesUpTo(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array | undefined> {
  if (body === null) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > mostAnswerBytes) {
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isRedirect({ status }: Readonly<Response>): boolean {
  return status >= 300 && status < 400;
}

async function boundedAnswerOf(answer: Readonly<Response>): Promise<Result.Result<Response, string>> {
  if (isRedirect(answer)) {
    await answer.body?.cancel();
    return Result.fail(redirected);
  }
  const bytes = await bytesUpTo(answer.body);
  return bytes === undefined
    ? Result.fail(`answers more than ${mostAnswerBytes / 1024} KiB`)
    : Result.succeed(
        new Response(bytes.byteLength === 0 ? null : new Uint8Array(bytes), {
          status: answer.status,
          headers: answer.headers,
        }),
      );
}

function signalWithin(given: Readonly<AbortSignal> | undefined): AbortSignal {
  const bound = AbortSignal.timeout(providerAnswerSeconds * 1000);
  return given === undefined ? bound : AbortSignal.any([given, bound]);
}

export interface ProviderRequest {
  readonly body?: Readonly<FetchBody>;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly signal?: Readonly<AbortSignal> | undefined;
}

export async function answerAt(
  { fetch }: ProviderRequests,
  address: string,
  { body, headers, method, signal }: ProviderRequest,
): Promise<Result.Result<Response, string>> {
  try {
    const request = new Request(address, {
      body: body ?? null,
      headers,
      method,
      redirect: 'error',
      signal: signalWithin(signal),
    });
    return await boundedAnswerOf(await fetch(request));
  } catch (error) {
    return Result.fail(unreached(error));
  }
}

export function boundedFetchOf(requests: ProviderRequests): CustomFetch {
  return async (address: string, request: ProviderRequest) => {
    const answer = await answerAt(requests, address, request);
    if (Result.isFailure(answer)) {
      throw new UnreadAnswer({ message: answer.failure });
    }
    return answer.success;
  };
}

export function failureOfAnAnswer(error: unknown): string | undefined {
  return Predicate.hasProperty(error, 'cause') && error.cause instanceof UnreadAnswer ? error.cause.message : undefined;
}
