import type { FetchLike } from '@modelcontextprotocol/client';
import { boundedAnswerOf } from '@on.auto/outbound';
import { Option, Schema } from 'effect';

import { ignored } from '../clients/ignored.ts';
import { answeredAClientError } from '../consent/consent-failures.ts';
import { valueAt } from '../openapi/failure-codes.ts';
import { AssertionRefused } from './assertion-refused.ts';
import { TokenRequestFailed } from './token-request-failed.ts';
import type { TokenRequest } from './token-requests.ts';

export interface AssertedTokens {
  readonly access_token: string;
  readonly expires_in?: number | undefined;
}

export interface Requesting {
  readonly fetch: FetchLike;
  readonly now: () => number;
}

export const mostAnswerBytes = 65_536;

const millisOfASecond = 1000;

const rateLimited = 429;

const firstServerError = 500;

const statusesOfAWait: ReadonlySet<number> = new Set([408, rateLimited]);

const answerOfText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function textAt(answer: unknown, pointer: string | undefined): string | undefined {
  const value = pointer === undefined ? undefined : valueAt(answer, pointer);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function secondsLeftOf(endsAt: string | undefined, now: number): number | undefined {
  const seconds = Math.floor(((endsAt === undefined ? Number.NaN : Date.parse(endsAt)) - now) / millisOfASecond);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

interface Answered {
  readonly status: number;
  readonly host: string;
}

function tokensIn(text: string, { issued }: TokenRequest, { status, host }: Answered, now: number): AssertedTokens {
  const unreadable = () => new TokenRequestFailed(status, host, false);
  const answer = Option.getOrThrowWith(answerOfText(text), unreadable);
  const accessToken = Option.getOrThrowWith(Option.fromNullishOr(textAt(answer, issued.access_token)), unreadable);
  const expiresIn = secondsLeftOf(textAt(answer, issued.expires_at), now);
  return expiresIn === undefined ? { access_token: accessToken } : { access_token: accessToken, expires_in: expiresIn };
}

function failureOf(status: number, host: string): Error {
  if (answeredAClientError(status) && !statusesOfAWait.has(status)) {
    return new AssertionRefused(`HTTP ${String(status)}`);
  }
  return new TokenRequestFailed(status, host, status === rateLimited || status >= firstServerError);
}

function sentOf(body: Schema.Json | undefined) {
  return body === undefined
    ? { headers: {} }
    : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export async function tokensRequestedOf(
  request: TokenRequest,
  bearer: string,
  { fetch, now }: Requesting,
  body?: Schema.Json,
): Promise<AssertedTokens> {
  const sent = sentOf(body);
  const answer = await fetch(request.url, {
    method: request.method,
    ...sent,
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json', ...sent.headers },
    redirect: 'manual',
  });
  const host = new URL(request.url).hostname;
  const text = await boundedAnswerOf(answer, mostAnswerBytes, ignored).text();
  if (answer.ok) {
    return tokensIn(text, request, { status: answer.status, host }, now());
  }
  throw failureOf(answer.status, host);
}
