import type { ConsentCall, ConsentCallAnswer, ConsentStep } from './consent-client.ts';

type Failed = Extract<ConsentCallAnswer, { readonly failed: string }>['failed'];

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

export function callWordsOf({ step, host, answer }: ConsentCall): string {
  const asked = stepsNamed[step];
  return 'status' in answer
    ? `${host} answered ${asked} with HTTP ${answer.status}`
    : failedWords[answer.failed](host, asked);
}

export function waitWordsOf({ answer }: ConsentCall): string {
  return 'status' in answer && answer.retryAfterMs !== null
    ? `try again in ${waitOf(answer.retryAfterMs)}`
    : 'try again in a moment';
}
