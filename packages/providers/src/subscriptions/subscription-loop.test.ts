import { capturedLogs, recordingTracer } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { intoAQueue, ofEachSubscription, overASocket } from '../testing/event-destinations.ts';
import { inMemoryRecords } from '../testing/loop-records.ts';
import { answeringItsSecret, declaredDestinations } from '../testing/subscription-apps.ts';
import { alpha, loopOver, portsOf, roundAt, startedAt, type Loop } from '../testing/subscription-loops.ts';
import { theQueue } from '../testing/subscription-services.ts';
import { subscriptionLoopOf } from './subscription-loop.ts';

const connected = '2026-10-01T08:00:00.000Z';

const anHour = 3_600_000;

const aDay = 24 * anHour;

const threeDays = 3 * aDay;

const byRequest = declaredDestinations(ofEachSubscription);

const byTool = declaredDestinations(intoAQueue);

const inAlpha = { connection: 'tracker', topic: 'alpha' };

const inC0123 = { connection: 'chat', topic: 'C0123' };

function over(destinations: typeof byRequest, connection = 'tracker') {
  return { id: `id-of-${connection}`, connection, connected, destinations };
}

describe('the loop, from nothing arranged', () => {
  it('converges, and a round after it changes nothing', async () => {
    const loop = loopOver([over(byRequest)], [inAlpha]);
    const ports = portsOf(loop, {});

    expect(await roundAt(ports, startedAt)).toEqual({});
    expect(await roundAt(ports, startedAt + aDay)).toEqual({});
    expect(loop.app.acts()).toEqual(['subscribe']);
    expect(loop.app.held()).toHaveLength(1);
    expect(loop.records.facts()).toHaveLength(1);
    expect(loop.records.facts()).toMatchObject([
      { type: 'made', key: inAlpha, made: { type: 'webhook', id: 'hook-1', secretId: 'secret-1' } },
    ]);
    expect([...loop.secrets.kept().keys()]).toEqual(['secret-1']);
  });

  it('renews a lease halfway through it, and subscribes again once it has lapsed', async () => {
    const loop = loopOver([over(byTool, 'chat')], [inC0123]);
    const ports = portsOf(loop, {});

    expect(await roundAt(ports, startedAt)).toEqual({ nextDueAt: startedAt + threeDays / 2 });
    expect(await roundAt(ports, startedAt + threeDays / 2)).toEqual({ nextDueAt: startedAt + threeDays });
    expect(loop.records.rows()).toMatchObject([
      { positions: { failures: 0, lapsesAt: startedAt + threeDays + threeDays / 2 } },
    ]);
    await roundAt(ports, startedAt + 10 * aDay);
    expect(loop.app.acts()).toEqual(['subscribe', 'renew', 'subscribe']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'removed', 'made']);
    expect(loop.records.rows()).toMatchObject([{ made: { type: 'queue', id: 'hook-2' } }]);
  });
});

describe('the loop, from what is arranged', () => {
  it('removes what no asker names any more, and forgets its secret', async () => {
    const loop = loopOver([over(byRequest)], [inAlpha]);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.askers[0]?.becomes();
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe']);
    expect(loop.app.held()).toEqual([]);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'removed']);
    expect(loop.records.rows()).toEqual([]);
    expect(loop.secrets.kept().size).toBe(0);
  });

  it('after a rebuild, where positions restart at their defaults, renews a lease at once and calls nothing else', async () => {
    const loop = loopOver([over(byRequest), over(byTool, 'chat')], [inAlpha, inC0123]);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.records.rebuilt();

    expect(await roundAt(ports, startedAt + anHour)).toEqual({ nextDueAt: startedAt + anHour + threeDays / 2 });
    expect(await roundAt(ports, startedAt + 2 * anHour)).toEqual({ nextDueAt: startedAt + anHour + threeDays / 2 });
    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe', 'renew']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'made']);
  });
});

describe('the loop, after a rebuild', () => {
  const readingTheLeasesEnd = {
    ...intoAQueue,
    renew: { ...intoAQueue.renew, with: { ...intoAQueue.renew.with, after: '{{ subscription.expires_at }}' } },
  };

  it('subscribes again where the renewal reads the end of a lease the rebuild forgot', async () => {
    const loop = loopOver([over(declaredDestinations(readingTheLeasesEnd), 'chat')], [inC0123]);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.records.rebuilt();
    await roundAt(ports, startedAt + anHour);
    await roundAt(ports, startedAt + 2 * anHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe', 'unsubscribe']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'removed', 'made']);
    expect(loop.app.held().map(({ id }) => id)).toEqual(['hook-2']);
  });
});

describe('a stop between the call and the record', () => {
  it('leaves one subscription Auto does not know, and a repeated round adds no other', async () => {
    const loop = loopOver([over(byRequest)], [inAlpha]);
    const ports = portsOf(loop, {});
    loop.records.stopsBeforeTheNextMade();

    await expect(roundAt(ports, startedAt)).rejects.toThrow('the runtime stopped');
    expect([loop.app.held().length, loop.records.facts().length]).toEqual([1, 0]);
    await roundAt(ports, startedAt + anHour);
    await roundAt(ports, startedAt + 2 * anHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe']);
    expect([loop.app.held().length, loop.records.rows().length, loop.secrets.kept().size]).toEqual([2, 1, 2]);
  });

  it('is what a restore to before the record leaves: the app keeps the one Auto forgot', async () => {
    const loop = loopOver([over(byRequest)], [inAlpha]);
    await roundAt(portsOf(loop, {}), startedAt);
    const restored: Loop = { ...loop, records: inMemoryRecords(64) };
    await roundAt(portsOf(restored, {}), startedAt + anHour);
    await roundAt(portsOf(restored, {}), startedAt + 2 * anHour);

    expect([loop.app.held().length, restored.records.rows().length]).toEqual([2, 1]);
  });
});

describe('a round handed a deadline', () => {
  it('starts no step at or past it, says so, is due again where it stopped, and the next round goes on', async () => {
    const loop = loopOver([over(byRequest), over(byRequest, 'chat')], [inAlpha, inC0123]);
    const slow = portsOf(loop, { stepMs: anHour });
    const acted = async (at: number, deadline?: number) => [await roundAt(slow, at, deadline), loop.app.acts().length];

    expect([await acted(startedAt, startedAt), await acted(startedAt, startedAt + anHour)]).toEqual([
      [{ nextDueAt: startedAt, deadlineExceeded: true }, 0],
      [{ nextDueAt: startedAt + anHour, deadlineExceeded: true }, 1],
    ]);
    expect(await acted(startedAt + 2 * anHour)).toEqual([{}, 2]);
  });
});

describe('askers', () => {
  it('two that ask for one topic share one subscription, which stays while either asks and goes after the last', async () => {
    const loop = loopOver([over(byRequest)], [inAlpha], [inAlpha]);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.askers[0]?.becomes();
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toEqual(['subscribe']);
    loop.askers[1]?.becomes();
    await roundAt(ports, startedAt + 2 * anHour);
    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe']);
  });
});

describe('the bound', () => {
  it('arranges up to it through one connection, refuses the rest once, and takes the room a removal frees', async () => {
    const inBeta = { ...inAlpha, topic: 'beta' };
    const loop = loopOver([over(byRequest)], [inAlpha, inBeta]);
    const ports = portsOf(loop, { mostPerConnection: 1 });
    await roundAt(ports, startedAt);
    await roundAt(ports, startedAt + anHour);

    expect(loop.records.facts()).toMatchObject([
      { type: 'made', key: inAlpha },
      { type: 'failed', key: inBeta, failed: { kind: 'not_sent', because: 'not_sent' } },
    ]);
    loop.askers[0]?.becomes(inBeta);
    expect(await roundAt(ports, startedAt + 2 * anHour)).toEqual({ nextDueAt: startedAt + 2 * anHour });
    await roundAt(ports, startedAt + 2 * anHour);
    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe', 'subscribe']);
    expect(loop.records.rows()).toMatchObject([{ topic: 'beta', made: { id: 'hook-2' } }]);
  });
});

describe('a self-hosted runtime that takes no inbound connection', () => {
  const outwardOnly = { callbacks: { queue: theQueue }, receives: ['webhook', 'queue', 'websocket'] } as const;

  it('never arranges a webhook, and still arranges a queue it reads, or leaves it to a socket it opens', async () => {
    const toBoth = over(declaredDestinations(ofEachSubscription, intoAQueue));
    const toASocket = over(declaredDestinations(ofEachSubscription, overASocket), 'chat');
    const toAWebhook = over(byRequest, 'mail');
    const loop = loopOver([toBoth, toASocket, toAWebhook], [inAlpha, inC0123, { connection: 'mail', topic: 'alpha' }]);
    await roundAt(portsOf(loop, outwardOnly), startedAt);

    expect(loop.app.acts()).toEqual(['subscribe']);
    expect(loop.records.rows()).toMatchObject([{ connection: 'tracker', made: { type: 'queue' } }]);
  });

  it('replaces a webhook arranged while it had an address by the queue, once the address is gone', async () => {
    const loop = loopOver([over(declaredDestinations(ofEachSubscription, intoAQueue))], [inAlpha]);
    await roundAt(portsOf(loop, {}), startedAt);
    await roundAt(portsOf(loop, outwardOnly), startedAt + anHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe', 'subscribe']);
    expect(loop.records.rows()).toMatchObject([{ made: { type: 'queue', id: 'hook-2' } }]);
    expect(loop.secrets.kept().size).toBe(0);
  });
});

describe('what the loop leaves behind', () => {
  it('holds no secret in a log, a span, a record or what it answers', async () => {
    const loop = loopOver(
      [over(byRequest), over(declaredDestinations(answeringItsSecret), 'chat')],
      [inAlpha, inC0123],
    );
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
    const answered = [await traced(startedAt), await traced(startedAt + 2 * anHour)];
    loop.app.fails('unreachable', 1);
    loop.askers[0]?.becomes({ ...inAlpha, topic: 'beta' });
    answered.push(await traced(startedAt + 3 * anHour));
    const left = JSON.stringify([
      answered,
      loop.records.facts(),
      loop.records.rows(),
      logs.logged(),
      recording.spans(),
    ]);

    expect([...loop.secrets.kept().values()].filter((secret) => left.includes(secret))).toEqual([]);
    expect(loop.secrets.kept().size).toBeGreaterThan(1);
    expect([logs.logged(), recording.spans()]).toEqual([[], []]);
  });
});
