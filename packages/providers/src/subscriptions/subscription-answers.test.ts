import { inspect } from 'node:util';

import { capturedLogs, recordingTracer } from '@on.auto/operations/testing';
import type { CalledOnce, RequestedOnce } from '@on.auto/tool-servers';
import { Cause, Effect, Exit, Redacted, Result, type Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { intoAQueue, ofEachSubscription } from '../testing/event-destinations.ts';
import {
  aService,
  aServiceAnsweringRequests,
  answeredAsText,
  answeredNothing,
  answeredSecretOf,
  answeredStructured,
  answeredWith,
  assetNotSent,
  declared,
  destinationOf,
  failedAs,
  notOfferedAs,
  notReadOnly,
  place,
  rateLimited,
  refusedByTheTool,
  serverFailedAs,
  serverFailureAs,
  type FakeService,
} from '../testing/subscription-services.ts';
import { subscriptionCallsOf } from './subscription-calls.ts';

const madeText = 'made-by-auto-7f3a9c1e5b2d4f60';

const byRequest = destinationOf(ofEachSubscription);

const intoTheQueue = destinationOf(intoAQueue, 'queue');

const answeringItsSecret = destinationOf({
  ...ofEachSubscription,
  subscribe: { tool: 'create_hook', with: { at: '{{ webhook_url }}' }, subscribed: { id: '/id', secret: '/key' } },
  verify: { scheme: 'bearer', secret: 'subscription', token: '$request.header.X-Tracker-Token' },
});

const placingItsSecret = destinationOf({
  ...ofEachSubscription,
  subscribe: { tool: 'create_hook', with: { at: '{{ webhook_url }}', key: '{{ secret }}' }, subscribed: { id: '/id' } },
});

function onTheClock<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect).pipe(Effect.provide(TestClock.layer())));
}

function subscribing(service: FakeService, destination = intoTheQueue) {
  const asked = { destination: { ...destination, subscribe: declared(destination.subscribe) }, place, topic: 'alpha' };
  return subscriptionCallsOf(service.ports).subscribe({
    ...asked,
    connectionId: 'id-of-tracker',
    madeSecret: Effect.succeed(Redacted.make(madeText)),
  });
}

function subscribedOn(answer: CalledOnce, destination = intoTheQueue) {
  return onTheClock(subscribing(aService([answer]), destination));
}

function lapsing(expirationDateTime: Schema.Json) {
  return subscribedOn(answeredWith({ id: 'sub-1', expirationDateTime }));
}

function unsubscribedThrough(service: FakeService, destination = intoTheQueue) {
  const declaring = { ...destination, unsubscribe: declared(destination.unsubscribe) };
  const unsubscribing = { destination: declaring, place, topic: 'alpha', subscription: { id: '42' } };
  return onTheClock(subscriptionCallsOf(service.ports).unsubscribe(unsubscribing));
}

function unsubscribedOn(answer: CalledOnce) {
  return unsubscribedThrough(aService([answer]));
}

function unsubscribedByRequestOn(answer: RequestedOnce) {
  return unsubscribedThrough(aServiceAnsweringRequests([answer]), byRequest);
}

function renewedOn(answer: CalledOnce) {
  const destination = { ...intoTheQueue, renew: declared(intoTheQueue.renew) };
  const renewing = { destination, place, topic: 'C0123', subscription: { id: 'sub-1' } };
  return onTheClock(subscriptionCallsOf(aService([answer]).ports).renew(renewing));
}

interface Refusal {
  readonly answer: CalledOnce;
  readonly kind: string;
  readonly because: string;
}

function refusal(answer: CalledOnce, kind: string, because: string): Refusal {
  return { answer, kind, because };
}

const refusals: readonly Refusal[] = [
  refusal(notOfferedAs('connection_pending'), 'connection_broken', 'connection_pending'),
  refusal(notOfferedAs('connection_broken'), 'connection_broken', 'connection_broken'),
  refusal(notOfferedAs('tool_server_not_configured'), 'connection_broken', 'tool_server_not_configured'),
  refusal(serverFailedAs('key_refused'), 'connection_broken', 'key_refused'),
  refusal(serverFailedAs('scope_lacking'), 'scope_lacking', 'scope_lacking'),
  refusal(notOfferedAs('tool_not_allowed'), 'scope_lacking', 'tool_not_allowed'),
  refusal(notOfferedAs('connection_not_allowed'), 'scope_lacking', 'connection_not_allowed'),
  refusal(refusedByTheTool('No such project'), 'tool_error', 'tool_error'),
  refusal(failedAs('arguments_refused'), 'tool_error', 'arguments_refused'),
  refusal(notOfferedAs('tool_not_listed'), 'tool_error', 'tool_not_listed'),
  refusal(notReadOnly, 'tool_error', 'tool_not_read_only'),
  refusal(assetNotSent, 'tool_error', 'asset_not_sent'),
  refusal(failedAs('too_large'), 'tool_error', 'too_large'),
  refusal(serverFailedAs('unreachable'), 'unreachable', 'unreachable'),
  refusal(serverFailedAs('failing'), 'unreachable', 'failing'),
  refusal(serverFailedAs('rate_limited'), 'unreachable', 'rate_limited'),
  refusal(rateLimited, 'unreachable', 'rate_limited'),
  refusal(failedAs('server_failure'), 'unreachable', 'server_failure'),
  refusal(failedAs('timed_out'), 'unreachable', 'timed_out'),
  refusal(failedAs('cancelled'), 'unreachable', 'cancelled'),
  refusal(notOfferedAs('connection_unavailable'), 'unreachable', 'connection_unavailable'),
];

function failureIn({ kind, because }: Refusal) {
  return Result.fail(expect.objectContaining({ kind, because }));
}

describe('a failure, by what the connection layer says of it', () => {
  it('is the sign-in ended, the permission lacking, the app refusing or the service unreachable', async () => {
    const answers = await Promise.all(refusals.map(({ answer }) => unsubscribedOn(answer)));
    expect(answers).toEqual(refusals.map((each) => failureIn(each)));
  });
});

const unreadable = Result.fail(expect.objectContaining({ kind: 'tool_error', because: 'unreadable' }));

describe('what a call answers, read by the pointers its entry declares', () => {
  it('reads the id as text or a whole number, and nothing else', async () => {
    expect(await subscribedOn(answeredWith({ id: 'sub-1' }))).toEqual(Result.succeed({ id: 'sub-1' }));
    expect(await subscribedOn(answeredStructured({ id: 42 }))).toEqual(Result.succeed({ id: '42' }));
    const malformed: readonly Schema.Json[] = [{}, { id: '' }, { id: 1.5 }, { id: true }, { id: { value: 'sub-1' } }];
    expect(await Promise.all(malformed.map((answer) => subscribedOn(answeredWith(answer))))).toEqual(
      malformed.map(() => unreadable),
    );
    expect(await subscribedOn(answeredAsText('created'))).toEqual(unreadable);
    expect(await subscribedOn(answeredNothing)).toEqual(unreadable);
  });

  it('reads when a subscription lapses as an RFC 3339 time, and leaves out any other', async () => {
    expect(await lapsing('2026-10-10T11:00:00.5+02:00')).toEqual(
      Result.succeed({ id: 'sub-1', expiresAt: '2026-10-10T09:00:00.500Z' }),
    );
    const malformed = [1_791_622_800_000, 'in three days', '2026-02-30T09:00:00Z', '2026-12-31T23:59:60Z'];
    expect(await Promise.all(malformed.map((time) => lapsing(time)))).toEqual(
      malformed.map(() => Result.succeed({ id: 'sub-1' })),
    );
    expect(await renewedOn(answeredWith({ expirationDateTime: 'soon' }))).toEqual(Result.succeed({}));
  });

  it('takes the secret the service answers only as text, where the entry says it answers one', async () => {
    const answered = await subscribedOn(answeredWith({ id: 7, key: 'service-key-1' }), answeringItsSecret);
    expect(Result.map(answered, answeredSecretOf)).toEqual(Result.succeed('service-key-1'));
    const malformed: readonly Schema.Json[] = [{ id: 7 }, { id: 7, key: '' }, { id: 7, key: 7 }];
    expect(
      await Promise.all(malformed.map((answer) => subscribedOn(answeredWith(answer), answeringItsSecret))),
    ).toEqual(malformed.map(() => unreadable));
  });

  it('reads no answer larger than one Auto reads by pointers', async () => {
    expect(await subscribedOn(answeredWith({ id: 'sub-1', padding: 'x'.repeat(70_000) }))).toEqual(
      Result.fail(expect.objectContaining({ kind: 'tool_error', because: 'too_large' })),
    );
  });

  it('needs an answer only where it reads one, so an unsubscribe or a renewal answered with nothing is done', async () => {
    expect(await unsubscribedByRequestOn({ kind: 'answered', outcome: 'result' })).toEqual(Result.void);
    expect(await unsubscribedOn(answeredNothing)).toEqual(Result.void);
    expect(await renewedOn(answeredNothing)).toEqual(Result.succeed({}));
  });
});

interface Seen {
  readonly sent: string;
  readonly shown: readonly string[];
}

async function seenAfter(service: FakeService, destination: typeof byRequest): Promise<Seen> {
  const logs = capturedLogs();
  const tracing = recordingTracer();
  const traced = Effect.withSpan(subscribing(service, destination), 'the loop', { attributes: { round: 1 } });
  const exit = await Effect.runPromise(
    Effect.exit(Effect.withTracer(traced, tracing.tracer)).pipe(
      Effect.provide(logs.layer),
      Effect.provide(TestClock.layer()),
    ),
  );
  const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
  const failure = Cause.squash(cause);
  const shown = [Cause.pretty(cause), JSON.stringify(failure), inspect(failure), logs.text()];
  return { sent: JSON.stringify(service.sent()), shown: [...shown, JSON.stringify(tracing.spans())] };
}

describe('the secret of a subscription', () => {
  it('reaches the service in the call alone: never a failure, a log or a span', async () => {
    const echoed = `The secret ${madeText} is not one this service takes`;
    const answers = [
      refusedByTheTool(echoed),
      failedAs('server_failure', echoed),
      serverFailureAs('scope_lacking', echoed),
      notOfferedAs('tool_not_listed', echoed),
    ];
    const failedRequest = aServiceAnsweringRequests([
      { kind: 'answered', outcome: 'server_failure', because: 'failing' },
    ]);
    const seen = await Promise.all([
      ...answers.map((answer) => seenAfter(aService([answer]), placingItsSecret)),
      seenAfter(failedRequest, byRequest),
    ]);
    expect(seen.map(({ sent }) => sent.includes(madeText))).toEqual([true, true, true, true, true]);
    expect(seen.flatMap(({ shown }) => shown).filter((text) => text.includes(madeText))).toEqual([]);
  });

  it('is answered by the service redacted, so nothing that prints it shows it', async () => {
    const answered = Result.getOrThrow(
      await subscribedOn(answeredWith({ id: 7, key: 'service-key-1' }), answeringItsSecret),
    );
    const printed = [JSON.stringify(answered), inspect(answered, { depth: 5 }), inspect(answered.secret)];
    expect(printed.filter((text) => text.includes('service-key-1'))).toEqual([]);
    expect(answeredSecretOf(answered)).toBe('service-key-1');
  });
});
