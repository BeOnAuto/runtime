import { IssuerMismatchError, OAuthError, OAuthErrorCode, type FetchLike } from '@modelcontextprotocol/client';
import { boundedAnswerOf, causesOf } from '@on.auto/outbound';
import { Option, Schema } from 'effect';

import { ignored } from '../clients/ignored.ts';
import { retryAfterMsOf } from '../clients/observed-requests.ts';
import { failureOf } from '../clients/server-failures.ts';
import type {
  ConsentCall,
  ConsentCallAnswer,
  ConsentRefusal,
  ConsentStep,
  Refused,
  UnansweredCall,
} from './consent-client.ts';

export type CallRefusal = Refused<'host'> | UnansweredCall;

type RequestRefusal = Refused<'host' | 'unanswered'>;

const unanswered: RequestRefusal = { refused: 'unanswered' };

const invalidGrant: string = OAuthErrorCode.InvalidGrant;

const endedByTheBound: ReadonlySet<unknown> = new Set(['TimeoutError', 'AbortError']);

type Answered = Extract<ConsentCallAnswer, { readonly status: number }>;

const clientErrors = { first: 400, past: 500 };

const mostErrorBytes = 16_384;

const errorCodePattern = /^[\w.-]{1,64}$/u;

const decodeError = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.String.check(Schema.isPattern(errorCodePattern)) })),
);

export interface ObservedCalls {
  readonly fetch: FetchLike;
  readonly answeredWith: (judged: (status: number) => boolean) => boolean;
  readonly refusalOf: (error: unknown) => CallRefusal;
  readonly refusalOfTheAnswer: () => UnansweredCall;
}

export function answeredAClientError(status: number): boolean {
  return status >= clientErrors.first && status < clientErrors.past;
}

function isEndedByTheBound(error: unknown): boolean {
  return causesOf(error).some((cause) => 'name' in cause && endedByTheBound.has(cause.name));
}

function unansweredHow(error: unknown): ConsentCallAnswer {
  if (isEndedByTheBound(error)) {
    return { failed: 'timed_out' };
  }
  return failureOf(error).kind === 'unreachable' ? { failed: 'unreachable' } : { failed: 'failing' };
}

async function errorCodeIn(response: Readonly<Response>): Promise<string | undefined> {
  const text = await boundedAnswerOf(response.clone(), mostErrorBytes, ignored)
    .text()
    .catch(() => '');
  return Option.getOrUndefined(Option.map(decodeError(text), ({ error }) => error));
}

async function answeredBy(response: Readonly<Response>): Promise<Answered> {
  const answered = {
    status: response.status,
    retryAfterMs: retryAfterMsOf(response.headers.get('retry-after'), Date.now()),
  };
  const errorCode = response.ok ? undefined : await errorCodeIn(response);
  return errorCode === undefined ? answered : { ...answered, errorCode };
}

function answerOf(answered: Answered | undefined, error: unknown): ConsentCallAnswer {
  if (answered === undefined) {
    return unansweredHow(error);
  }
  return answered.status >= 200 && answered.status < 300 ? { failed: 'unreadable' } : answered;
}

function unansweredAt(call: ConsentCall): UnansweredCall {
  return { refused: 'unanswered', call };
}

export function observedCalls(step: ConsentStep, first: string, fetch: FetchLike): ObservedCalls {
  const last: { asked: string; answered: Answered | undefined } = { asked: first, answered: undefined };
  const callRefusalOf = (error?: unknown): UnansweredCall =>
    unansweredAt({ step, host: new URL(last.asked).host, answer: answerOf(last.answered, error) });
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      last.asked = String(address);
      last.answered = undefined;
      const response = await fetch(last.asked, Object.assign({}, init));
      last.answered = await answeredBy(response);
      return response;
    },
    answeredWith: (judged) => last.answered !== undefined && judged(last.answered.status),
    refusalOf: (error) => {
      const failure = failureOf(error);
      return failure.kind === 'not_allowed' ? { refused: 'host', rule: failure.message } : callRefusalOf(error);
    },
    refusalOfTheAnswer: () => callRefusalOf(),
  };
}

export function refusalOf(error: unknown): RequestRefusal {
  const failure = failureOf(error);
  return failure.kind === 'not_allowed' ? { refused: 'host', rule: failure.message } : unanswered;
}

export function discoveryRefusalOf(error: unknown, observed: ObservedCalls): Refused<'another_issuer'> | CallRefusal {
  return error instanceof IssuerMismatchError
    ? { refused: 'another_issuer', named: String(error.received), by: 'authorization_server' }
    : observed.refusalOf(error);
}

export function isInvalidGrant(error: unknown): boolean {
  return error instanceof OAuthError && error.code === invalidGrant;
}

export function exchangeRefusalOf(error: unknown, observed: ObservedCalls): ConsentRefusal {
  if (error instanceof IssuerMismatchError) {
    return { refused: 'iss' };
  }
  return isInvalidGrant(error) ? { refused: 'code' } : observed.refusalOf(error);
}
