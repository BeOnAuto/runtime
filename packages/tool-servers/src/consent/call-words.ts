import type { ConsentCall, ConsentCallAnswer, ConsentStep } from './consent-client.ts';
import { answeredAClientError } from './consent-failures.ts';

type Failed = Extract<ConsentCallAnswer, { readonly failed: string }>['failed'];

type Answered = Extract<ConsentCallAnswer, { readonly status: number }>;

export interface CallWords {
  readonly told: string;
  readonly wait: string | undefined;
}

const stepsNamed: Readonly<Record<ConsentStep, string>> = {
  ping: 'the request sent without a token',
  resource_metadata: 'the read of its protected resource metadata',
  authorization_server_metadata: 'the read of its authorization server metadata',
  registration: 'the registration of a client',
  token: 'a request to its token endpoint',
};

const failedWords: Readonly<Record<Failed, (host: string, asked: string) => string>> = {
  timed_out: (host, asked) => `${host} did not answer ${asked} in time`,
  unreachable: (host, asked) => `${host} could not be reached for ${asked}`,
  unreadable: (host, asked) => `${host} answered ${asked} with a document this runtime cannot read`,
  failing: (host, asked) => `${host} did not answer ${asked}`,
};

const millisOfASecond = 1000;

const secondsOfAMinute = 60;

const secondsOfAnHour = 3600;

const mostSecondsCounted = 120;

const mostMinutesCounted = 7200;

function countedIn(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function waitOf(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / millisOfASecond));
  if (seconds < mostSecondsCounted) {
    return countedIn(seconds, 'second');
  }
  return seconds < mostMinutesCounted
    ? countedIn(Math.ceil(seconds / secondsOfAMinute), 'minute')
    : countedIn(Math.ceil(seconds / secondsOfAnHour), 'hour');
}

function unservedWords(host: string, served: string, status: number): string {
  return `${host} does not serve ${served} (HTTP ${status}); the server may take an API key instead of a sign-in`;
}

const refusedWords: Readonly<Partial<Record<ConsentStep, (host: string, answered: Answered) => string>>> = {
  registration: (host, { errorCode }) =>
    `${host} refuses to register a client${errorCode === undefined ? '' : ` (${errorCode})`}; its sign-in is open only to clients it already knows; connect with an API key instead, if the server takes one`,
  resource_metadata: (host, { status }) => unservedWords(host, 'its protected resource metadata', status),
  authorization_server_metadata: (host, { status }) => unservedWords(host, 'its authorization server metadata', status),
};

const waitingStatuses: ReadonlySet<number> = new Set([408, 429]);

function isRefusal({ status }: Answered): boolean {
  return answeredAClientError(status) && !waitingStatuses.has(status);
}

function waitWordsOf(answer: ConsentCallAnswer): string {
  return 'status' in answer && answer.retryAfterMs !== null
    ? `try again in ${waitOf(answer.retryAfterMs)}`
    : 'try again in a moment';
}

function answeredWordsOf({ step, host, answer }: ConsentCall): string {
  const asked = stepsNamed[step];
  return 'status' in answer
    ? `${host} answered ${asked} with HTTP ${answer.status}`
    : failedWords[answer.failed](host, asked);
}

export function callWordsOf(call: ConsentCall): CallWords {
  const { step, host, answer } = call;
  if ('status' in answer && isRefusal(answer)) {
    return { told: refusedWords[step]?.(host, answer) ?? answeredWordsOf(call), wait: undefined };
  }
  return { told: answeredWordsOf(call), wait: waitWordsOf(answer) };
}
