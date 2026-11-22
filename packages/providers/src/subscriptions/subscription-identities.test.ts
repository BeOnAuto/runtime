import { capturedLogs, recordingTracer } from '@on.auto/operations/testing';
import { Effect, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { IdentitySchema } from '../events/identity-call.ts';
import { ofEachSubscription, whoItActsAs, whoItActsAsThroughATool } from '../testing/event-destinations.ts';
import { declaredDestinations } from '../testing/subscription-apps.ts';
import { alpha, loopOver, portsOf, roundAt, startedAt } from '../testing/subscription-loops.ts';
import { identitiesReadOf } from './subscription-identities.ts';
import { subscriptionLoopOf } from './subscription-loop.ts';

const connected = '2026-10-01T08:00:00.000Z';

const anHour = 3_600_000;

const byRequest = declaredDestinations(ofEachSubscription);

const asked = Schema.decodeUnknownSync(IdentitySchema);

const inAlpha = { connection: 'tracker', topic: 'alpha' };

function through(connection: string, identity?: unknown) {
  const identify = identity === undefined ? {} : { identify: asked(identity) };
  return { id: `id-of-${connection}`, connection, connected, destinations: byRequest, ...identify };
}

const owing = through('tracker', whoItActsAs);

describe('the account a connection acts as, read by a round', () => {
  it('is asked of the service before the round subscribes through a connection a trigger listens through, recorded once for its connecting, and never logged', async () => {
    const loop = loopOver([owing]);
    loop.triggered.becomes(inAlpha);
    const ports = portsOf(loop, {});
    const logs = capturedLogs();
    const recording = recordingTracer();
    const traced = (time: number) =>
      Effect.runPromise(
        TestClock.setTime(time).pipe(
          Effect.andThen(subscriptionLoopOf(ports)(alpha)),
          Effect.withTracer(recording.tracer),
          Effect.provide(TestClock.layer()),
          Effect.provide(logs.layer),
        ),
      );
    await traced(startedAt);
    await traced(startedAt + anHour);

    expect(loop.app.acts()).toEqual(['identify', 'subscribe']);
    expect(loop.identified()).toEqual([
      { connection: { id: 'id-of-tracker', connected }, user: { id: 'member-7', name: 'sam' } },
    ]);
    expect(loop.records.facts()).toMatchObject([{ type: 'made', key: inAlpha }]);
    expect([logs.logged(), recording.spans()]).toEqual([[], []]);
  });

  it('is read through a tool of the connection too, where the entry says so, an id written as a whole number kept as its decimal', async () => {
    const loop = loopOver([through('tracker', whoItActsAsThroughATool)]);
    loop.triggered.becomes(inAlpha);
    await roundAt(portsOf(loop, {}), startedAt);

    expect(loop.app.acts()).toEqual(['identify', 'subscribe']);
    expect(loop.identified().map(({ user }) => user)).toEqual([{ id: '7' }]);
  });
});

describe('a read of the account a connection acts as that fails', () => {
  it('fails the subscription, which subscribes nothing, and is asked again when the subscription is tried again', async () => {
    const loop = loopOver([owing]);
    loop.triggered.becomes(inAlpha);
    loop.app.fails('unreachable', 1);
    const ports = portsOf(loop, {});
    const { nextDueAt } = await roundAt(ports, startedAt);

    expect(loop.app.acts()).toEqual(['identify']);
    expect(loop.records.facts()).toMatchObject([
      { type: 'failed', key: inAlpha, failed: { kind: 'unreachable', because: 'unreachable' } },
    ]);
    expect(nextDueAt).toBeGreaterThan(startedAt);
    await roundAt(ports, Option.getOrThrow(Option.fromNullishOr(nextDueAt)));
    expect(loop.app.acts()).toEqual(['identify', 'identify', 'subscribe']);
    expect(loop.identified()).toHaveLength(1);
  });

  it('is a lasting failure of the subscription where the answer names no account at the declared pointer, which holds it as a refused call would', async () => {
    const loop = loopOver([through('tracker', { ...whoItActsAs, identified: { id: '/nobody' } })]);
    loop.triggered.becomes(inAlpha);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toEqual(['identify', 'identify']);
    expect(loop.records.facts()).toMatchObject([
      { type: 'failed', key: inAlpha, failed: { kind: 'tool_error', because: 'unreadable' } },
    ]);
    expect(loop.identified()).toEqual([]);
  });
});

describe('what a read of the account that fails holds back', () => {
  it('is the trigger’s subscribe, recorded as never sent where the read timed out, so it is tried again after the connection’s back-off, not held as a subscribe whose outcome is unknown', async () => {
    const loop = loopOver([owing]);
    loop.triggered.becomes(inAlpha);
    loop.app.fails('timed_out', 1);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toEqual(['identify', 'identify', 'subscribe']);
    expect(loop.records.facts()).toMatchObject([
      { type: 'failed', key: inAlpha, failed: { kind: 'unreachable', because: 'timed_out' } },
      { type: 'made', key: inAlpha },
    ]);
  });

  it('is only what a trigger asks for: a subscription only a request asks for through the connection is made as before, one both ask for waits', async () => {
    const forARequest = { connection: 'tracker', topic: 'beta' };
    const loop = loopOver([owing], [inAlpha, forARequest]);
    loop.triggered.becomes(inAlpha);
    loop.app.fails('unreachable', 1);
    await roundAt(portsOf(loop, {}), startedAt);

    expect(loop.app.acts()).toEqual(['identify', 'subscribe']);
    expect(loop.records.facts().map(({ type, key }) => [key.topic, type])).toEqual(
      expect.arrayContaining([
        ['alpha', 'failed'],
        ['beta', 'made'],
      ]),
    );
    expect(loop.records.facts()).toHaveLength(2);
  });
});

describe('the connections a round asks the account of', () => {
  it('are none where only a request listens through the connection, whose entry declares none or that holds no connecting; each subscribes as before', async () => {
    const notConnected = {
      id: 'id-of-mail',
      connection: 'mail',
      destinations: byRequest,
      identify: asked(whoItActsAs),
    };
    const loop = loopOver([owing, through('chat'), notConnected], [inAlpha]);
    loop.triggered.becomes({ connection: 'chat', topic: 'alpha' }, { connection: 'mail', topic: 'alpha' });
    await roundAt(portsOf(loop, {}), startedAt);

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe', 'subscribe']);
    expect(loop.identified()).toEqual([]);
  });

  it('take one whose subscription is made already, with no step through it, and a failure there records nothing on the subscription', async () => {
    const loop = loopOver([owing], [inAlpha]);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.triggered.becomes(inAlpha);
    loop.app.fails('unreachable', 1);
    await roundAt(ports, startedAt + anHour);
    await roundAt(ports, startedAt + 2 * anHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'identify', 'identify']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made']);
    expect(loop.identified()).toHaveLength(1);
  });

  it('are not asked at or past the round’s deadline, which is said and due again, and are asked once the next round starts before it', async () => {
    const loop = loopOver([owing]);
    loop.triggered.becomes(inAlpha);
    const ports = portsOf(loop, {});

    expect(await roundAt(ports, startedAt, startedAt)).toEqual({ nextDueAt: startedAt, deadlineExceeded: true });
    expect(loop.app.acts()).toEqual([]);
    expect(await roundAt(ports, startedAt, startedAt + anHour)).toEqual({});
    expect(loop.app.acts()).toEqual(['identify', 'subscribe']);
  });
});

describe('the accounts of connections read on their own, as a shell reads those it arranges hearing through itself', () => {
  it('records each answer and hands back each failure by the connection’s name, passing a connection that owes none', async () => {
    const connections = [through('chat', whoItActsAs), owing, through('mail')];
    const loop = loopOver(connections);
    const read = identitiesReadOf(portsOf(loop, {}));
    loop.app.fails('timed_out', 1);
    const { unread } = await Effect.runPromise(read(alpha, connections).pipe(Effect.provide(TestClock.layer())));

    expect([...unread]).toEqual([['chat', expect.objectContaining({ kind: 'unreachable', because: 'timed_out' })]]);
    expect(loop.identified().map(({ connection }) => connection.id)).toEqual(['id-of-tracker']);
    expect(loop.connections.now().map(({ identify }) => identify !== undefined)).toEqual([true, false, false]);
  });
});

describe('the account a connection is in, where its entry says where the same call names it', () => {
  it('is read beside the account it acts as and reaches the recorder as a member of its own, none where the answer names none there, and none where the entry says nothing of it', async () => {
    const connections = [
      through('chat', { ...whoItActsAs, account: '/team/key' }),
      through('mail', { ...whoItActsAs, account: '/team/name' }),
      owing,
    ];
    const loop = loopOver(connections);
    await Effect.runPromise(
      identitiesReadOf(portsOf(loop, {}))(alpha, connections).pipe(Effect.provide(TestClock.layer())),
    );

    expect(loop.identified().map(({ connection, ...identification }) => [connection.id, identification])).toEqual([
      ['id-of-chat', { user: { id: 'member-7', name: 'sam' }, account: { id: 'team-3' } }],
      ['id-of-mail', { user: { id: 'member-7', name: 'sam' } }],
      ['id-of-tracker', { user: { id: 'member-7', name: 'sam' } }],
    ]);
  });
});
