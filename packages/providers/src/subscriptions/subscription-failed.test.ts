import type { RequestedOnce } from '@on.auto/tool-servers';
import { Effect, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { intoAQueue, ofEachSubscription } from '../testing/event-destinations.ts';
import {
  aService,
  aServiceAnsweringRequests,
  declared,
  destinationOf,
  place,
  serverFailureAs,
  type FakeService,
  type SentReason,
} from '../testing/subscription-services.ts';
import { subscriptionCallsOf } from './subscription-calls.ts';
import type { SubscriptionFailureKind } from './subscription-failed.ts';

const byRequest = destinationOf(ofEachSubscription);

const byTool = destinationOf(intoAQueue, 'queue');

function unsubscribedThrough(service: FakeService, destination: typeof byRequest) {
  const declaring = { ...destination, unsubscribe: declared(destination.unsubscribe) };
  const asked = { destination: declaring, place, topic: 'alpha', subscription: { id: '42' } };
  const unsubscribed = subscriptionCallsOf(service.ports).unsubscribe(asked);
  return Effect.runPromise(Effect.result(unsubscribed).pipe(Effect.provide(TestClock.layer())));
}

interface Classed<Word> {
  readonly because: Word;
  readonly kind: SubscriptionFailureKind;
}

type ClassOfEach<Word extends string> = { readonly [Each in Word]: Classed<Each> };

type RequestFailedReason = Extract<RequestedOnce, { readonly outcome: 'server_failure' }>['because'];

const ofEachSentReason = {
  unreachable: { because: 'unreachable', kind: 'unreachable' },
  failing: { because: 'failing', kind: 'unreachable' },
  rate_limited: { because: 'rate_limited', kind: 'unreachable' },
  key_refused: { because: 'key_refused', kind: 'connection_broken' },
  connection_broken: { because: 'connection_broken', kind: 'connection_broken' },
  connection_pending: { because: 'connection_pending', kind: 'connection_broken' },
  scope_lacking: { because: 'scope_lacking', kind: 'scope_lacking' },
  connection_not_allowed: { because: 'connection_not_allowed', kind: 'scope_lacking' },
  connection_unavailable: { because: 'connection_unavailable', kind: 'unreachable' },
} as const satisfies ClassOfEach<SentReason> & ClassOfEach<RequestFailedReason>;

type UnopenedReason = Extract<RequestedOnce, { readonly kind: 'unopened' }>['because'];

const ofEachUnopenedReason = {
  ...ofEachSentReason,
  tool_server_not_configured: { because: 'tool_server_not_configured', kind: 'connection_broken' },
  tool_not_allowed: { because: 'tool_not_allowed', kind: 'scope_lacking' },
  tool_not_listed: { because: 'tool_not_listed', kind: 'tool_error' },
  too_large: { because: 'too_large', kind: 'tool_error' },
} as const satisfies ClassOfEach<UnopenedReason>;

type RequestOutcome = Exclude<Extract<RequestedOnce, { readonly kind: 'answered' }>['outcome'], 'result'>;

const ofEachRequestOutcome = {
  tool_error: { because: 'tool_error', kind: 'tool_error' },
  timed_out: { because: 'timed_out', kind: 'unreachable' },
  too_large: { because: 'too_large', kind: 'tool_error' },
} as const satisfies ClassOfEach<Exclude<RequestOutcome, 'server_failure'>>;

type Asked = readonly [RequestedOnce, Classed<string>];

function refusedBeforeSending(each: Classed<UnopenedReason>): Asked {
  return [{ kind: 'unopened', because: each.because }, each];
}

function endedAs(each: Classed<Exclude<RequestOutcome, 'server_failure'>>): Asked {
  return [{ kind: 'answered', outcome: each.because }, each];
}

function sentAndFailed(each: Classed<RequestFailedReason>): Asked {
  return [{ kind: 'answered', outcome: 'server_failure', because: each.because }, each];
}

function failureOf({ kind, because }: Classed<string>) {
  return Result.fail(expect.objectContaining({ kind, because }));
}

describe('a failure, by the reason word the connection layer gives', () => {
  it('classes a tool call that was sent and failed by its reason word, not all as unreachable', async () => {
    const classed = Object.values(ofEachSentReason);
    const services = classed.map(({ because }) => aService([serverFailureAs(because)]));
    const answers = await Promise.all(services.map((service) => unsubscribedThrough(service, byTool)));
    expect(answers).toEqual(classed.map((each) => failureOf(each)));
  });

  it('classes a request refused before it was sent by its word, and one sent by its outcome or its reason word', async () => {
    const asked = [
      ...Object.values(ofEachUnopenedReason).map((each) => refusedBeforeSending(each)),
      ...Object.values(ofEachRequestOutcome).map((each) => endedAs(each)),
      ...Object.values(ofEachSentReason).map((each) => sentAndFailed(each)),
    ];
    const services = asked.map(([answer]) => aServiceAnsweringRequests([answer]));
    const answers = await Promise.all(services.map((service) => unsubscribedThrough(service, byRequest)));
    expect(answers).toEqual(asked.map(([, each]) => failureOf(each)));
  });
});
