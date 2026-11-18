import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SentCallFailedBecause } from '../calls/call-facts.ts';
import type { FailureKind } from '../clients/server-failures.ts';
import { serverFailed } from '../org-servers/server-refusals.ts';
import { answeredOnce, refusedOnce, type CalledOnce } from './called-once.ts';

const everyFailure = {
  unreachable: 'unreachable',
  failing: 'failing',
  rate_limited: 'rate_limited',
  forgotten: 'forgotten',
  closed: 'closed',
  timed_out: 'timed_out',
  refused: 'refused',
  key_refused: 'key_refused',
  scope_lacking: 'scope_lacking',
  broken: 'broken',
  too_large: 'too_large',
  not_allowed: 'not_allowed',
} as const satisfies { readonly [Kind in FailureKind]: Kind };

function failedOnceSent(outcome: SentCallFailedBecause, failure: FailureKind | null): CalledOnce {
  const done = {
    outcome,
    failure,
    message: '',
    result: null,
    resultJson: null,
    jsonrpcId: 1,
    serverRequestId: null,
    retryAfterMs: null,
  };
  const fact = { because: outcome, duration_ms: 1, jsonrpc_id: 1 };
  return answeredOnce({ sent: true, answered: false, done, fact }, Function.identity, 'acts');
}

function refusedBeforeSending(failure: FailureKind): CalledOnce {
  const server = { settings: { name: 'graph' } };
  return refusedOnce(serverFailed(server, { kind: failure, message: '' }, { scrub: Function.identity }));
}

function reasonOf(called: CalledOnce): string | undefined {
  return 'because' in called ? called.because : undefined;
}

describe('the reason a sent call failed', () => {
  it('is the word a call refused before it was sent carries for the same failure of its server, whichever failure it is', () => {
    const failures = Object.values(everyFailure);
    const reasons = failures.map((failure) => reasonOf(failedOnceSent('server_failure', failure)));

    expect(reasons).toEqual(failures.map((failure) => reasonOf(refusedBeforeSending(failure))));
    expect(reasons).not.toContain(undefined);
  });

  it('is none for a call that ran out of its time, was cancelled, was answered past its cap or had its arguments refused, or whose failure was not named', () => {
    const ended = [
      failedOnceSent('timed_out', 'timed_out'),
      failedOnceSent('cancelled', null),
      failedOnceSent('too_large', 'too_large'),
      failedOnceSent('arguments_refused', null),
      failedOnceSent('server_failure', null),
    ];

    expect(ended.map((called) => reasonOf(called))).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
