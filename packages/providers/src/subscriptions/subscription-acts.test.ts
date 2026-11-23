import { describe, expect, it } from 'vitest';

import type { Destination } from '../events/destination-fields.ts';
import { socketBackoff } from '../sockets/socket-listening.ts';
import { intoAQueue, ofEachSubscription } from '../testing/event-destinations.ts';
import { inMemoryRecords } from '../testing/loop-records.ts';
import {
  anApp,
  answeringItsSecret,
  declaredDestinations,
  leasedWithoutRenewal,
  type AppAnswering,
  type Failing,
} from '../testing/subscription-apps.ts';
import { loopOver, portsOf, roundAt, startedAt, type Loop } from '../testing/subscription-loops.ts';
import type { SubscriptionKey } from './subscription-ports.ts';
import { resyncedAfterMs } from './subscription-records.ts';

const connected = '2026-10-01T08:00:00.000Z';

const anHour = 3_600_000;

const halfAnHour = anHour / 2;

const inAlpha: SubscriptionKey = { connection: 'tracker', topic: 'alpha' };

const tracker = { id: 'id-of-tracker', connection: 'tracker' };

function loopThrough(written: object, answering: AppAnswering = {}): Loop {
  const destinations = declaredDestinations(written);
  return { ...loopOver([{ ...tracker, connected, destinations }], [inAlpha]), app: anApp(answering) };
}

function reconnected(loop: Loop, destinations: readonly Destination[]) {
  loop.connections.becomes({ ...tracker, connected: '2026-10-08T08:00:00.000Z', destinations });
}

async function twoRounds(loop: Loop, apart: number) {
  await roundAt(portsOf(loop, {}), startedAt);
  return roundAt(portsOf(loop, {}), startedAt + apart);
}

describe('the app replaces a subscription by a new id', () => {
  it('which is removed then made, the old one unsubscribed and its secret kept', async () => {
    const loop = loopThrough(leasedWithoutRenewal);
    expect(await roundAt(portsOf(loop, {}), startedAt)).toEqual({ nextDueAt: startedAt + halfAnHour });
    await roundAt(portsOf(loop, {}), startedAt + halfAnHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe', 'unsubscribe']);
    expect(loop.app.held().map(({ id }) => id)).toEqual(['hook-2']);
    expect(loop.records.facts()).toMatchObject([
      { type: 'made', made: { id: 'hook-1', secretId: 'secret-1' } },
      { type: 'removed' },
      { type: 'made', made: { id: 'hook-2', secretId: 'secret-1' } },
    ]);
    expect([...loop.secrets.kept().keys()]).toEqual(['secret-1']);
  });

  it('and not where it answers the same id: subscribing again is then a renewal, which records nothing', async () => {
    const loop = loopThrough(leasedWithoutRenewal, { reusesIds: true });
    expect(await twoRounds(loop, halfAnHour)).toEqual({ nextDueAt: startedAt + anHour });

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made']);
  });
});

describe('the app replaces a subscription by a new secret', () => {
  it('which is removed then made for the same id, with nothing unsubscribed, and kept only when it differs', async () => {
    const same = loopThrough(answeringItsSecret, { reusesIds: true, reusesSecrets: true });
    const replaced = loopThrough(answeringItsSecret, { reusesIds: true });
    await Promise.all([same, replaced].map((loop) => twoRounds(loop, halfAnHour)));

    expect(same.records.facts().map(({ type }) => type)).toEqual(['made']);
    expect(replaced.app.acts()).toEqual(['subscribe', 'subscribe']);
    expect(replaced.records.facts()).toMatchObject([
      { type: 'made', made: { id: 'hook-1', secretId: 'secret-1' } },
      { type: 'removed' },
      { type: 'made', made: { id: 'hook-1', secretId: 'secret-2' } },
    ]);
    expect([...replaced.secrets.kept().keys()]).toEqual(['secret-2']);
  });

  it('which Auto makes again where the secret store no longer has the one it made', async () => {
    const loop = loopThrough(leasedWithoutRenewal, { reusesIds: true });
    await roundAt(portsOf(loop, {}), startedAt);
    loop.secrets.lost('secret-1');
    await roundAt(portsOf(loop, {}), startedAt + halfAnHour);

    expect(loop.records.rows()).toMatchObject([{ made: { id: 'hook-1', secretId: 'secret-2' } }]);
    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe']);
  });
});

describe('an entry that changes', () => {
  const body = { url: '{{ webhook_url }}', secret: '{{ secret }}', events: ['comment', 'review'] };
  const moreEvents = { ...ofEachSubscription, subscribe: { ...ofEachSubscription.subscribe, body } };

  it('replaces its subscriptions, unsubscribing first, and waits where that fails', async () => {
    const loop = loopThrough(ofEachSubscription);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.connections.becomes({ ...tracker, connected, destinations: declaredDestinations(moreEvents) });
    loop.app.fails('unreachable', 1);
    const { nextDueAt: retryAt = 0 } = await roundAt(ports, startedAt + anHour);
    await roundAt(ports, retryAt);

    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe', 'unsubscribe', 'subscribe']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'removed', 'made']);
    expect(loop.records.rows()).toMatchObject([{ made: { id: 'hook-2', secretId: 'secret-2' } }]);
    expect([...loop.secrets.kept().keys()]).toEqual(['secret-2']);
  });
});

interface EachWay {
  readonly failing: Failing;
  readonly way: string;
  readonly written: object;
}

const eachWay: readonly EachWay[] = (['connection_broken', 'scope_lacking', 'tool_error'] as const).flatMap(
  (failing) => [
    { failing, way: 'a request', written: ofEachSubscription },
    { failing, way: 'a tool', written: intoAQueue },
  ],
);

describe('a failure that will not pass by itself', () => {
  it.each(eachWay)('$failing of $way is recorded once, and tried again once connected again', async (each) => {
    const loop = loopThrough(each.written);
    const ports = portsOf(loop, {});
    loop.app.fails(each.failing, 1);
    expect(await roundAt(ports, startedAt)).toEqual({});
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toHaveLength(1);
    expect(loop.records.facts()).toHaveLength(1);
    expect(loop.records.facts()).toMatchObject([
      { type: 'failed', key: inAlpha, failed: { kind: each.failing, attempted: { connected } } },
    ]);
    reconnected(loop, declaredDestinations(each.written));
    await roundAt(ports, startedAt + 2 * anHour);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['failed', 'made']);
  });

  it('is tried again when the entry changes, as for a call Auto did not send', async () => {
    const loop = loopThrough(ofEachSubscription, { mostRequestBytes: 64 });
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    await roundAt(ports, startedAt + anHour);
    const changed = declaredDestinations(leasedWithoutRenewal);
    loop.connections.becomes({ ...tracker, connected, destinations: changed });
    await roundAt(ports, startedAt + 2 * anHour);

    expect(loop.app.acts()).toEqual([]);
    expect(loop.records.facts()).toMatchObject([
      { type: 'failed', failed: { kind: 'not_sent', because: 'not_sent' } },
      { type: 'failed', failed: { kind: 'not_sent', because: 'not_sent' } },
    ]);
    expect(loop.secrets.kept().size).toBe(0);
  });
});

describe('a failure that will not pass by itself, on what is arranged', () => {
  it("holds a subscription's renewal, and its removal until it lapses", async () => {
    const loop = loopThrough(intoAQueue);
    const ports = portsOf(loop, {});
    const { nextDueAt: due = 0 } = await roundAt(ports, startedAt);
    const lapsesAt = 2 * due - startedAt;
    loop.app.fails('scope_lacking', 2);
    expect(await roundAt(ports, due)).toEqual({ nextDueAt: lapsesAt });
    await roundAt(ports, due + anHour);
    reconnected(loop, declaredDestinations(intoAQueue));
    await roundAt(ports, due + 2 * anHour);
    loop.askers[0]?.becomes();
    expect(await roundAt(ports, due + 3 * anHour)).toEqual({ nextDueAt: lapsesAt });
    await roundAt(ports, lapsesAt);

    expect(loop.app.acts()).toEqual(['subscribe', 'renew', 'renew']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'failed', 'failed', 'removed']);
  });
});

describe('a failure that passes', () => {
  const [least, most] = [1 - socketBackoff.spread, 1 + socketBackoff.spread];

  it('is recorded once, and tried again after a wait that grows as the connection backoff does', async () => {
    const loop = loopThrough(ofEachSubscription);
    const ports = portsOf(loop, {});
    loop.app.fails('unreachable', 2);
    const { nextDueAt: first = 0 } = await roundAt(ports, startedAt);
    expect(first - startedAt).toBeGreaterThanOrEqual(socketBackoff.firstWaitMs * least);
    expect(first - startedAt).toBeLessThanOrEqual(socketBackoff.firstWaitMs * most);
    expect(await roundAt(ports, first - 1)).toEqual({ nextDueAt: first });
    const { nextDueAt: second = 0 } = await roundAt(ports, first);
    expect(second - first).toBeGreaterThanOrEqual(socketBackoff.firstWaitMs * socketBackoff.multiplier * least);
    await roundAt(ports, second);

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe', 'subscribe']);
    expect(loop.records.facts()).toMatchObject([{ type: 'failed', failed: { kind: 'unreachable' } }, { type: 'made' }]);
    expect(loop.records.rows()).toMatchObject([{ positions: { failures: 0 } }]);
  });

  it("on a subscription's renewal or removal records nothing, and is tried again after its wait", async () => {
    const loop = loopThrough(intoAQueue);
    const ports = portsOf(loop, {});
    const { nextDueAt: due = 0 } = await roundAt(ports, startedAt);
    loop.app.fails('unreachable', 1);
    const { nextDueAt: retried = 0 } = await roundAt(ports, due);
    await roundAt(ports, retried);
    loop.askers[0]?.becomes();
    loop.app.fails('unreachable', 1);
    const { nextDueAt: removedAt = 0 } = await roundAt(ports, retried + anHour);
    await roundAt(ports, removedAt);

    expect(loop.app.acts()).toEqual(['subscribe', 'renew', 'renew', 'unsubscribe', 'unsubscribe']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'removed']);
  });

  it('is recorded once while its reason changes from one try to the next', async () => {
    const loop = loopThrough(ofEachSubscription);
    const ports = portsOf(loop, {});
    loop.app.fails('unreachable', 1);
    loop.app.fails('rate_limited', 1);
    loop.app.fails('unreachable', 1);
    const { nextDueAt: first = 0 } = await roundAt(ports, startedAt);
    const { nextDueAt: second = 0 } = await roundAt(ports, first);
    await roundAt(ports, second);

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe', 'subscribe']);
    expect(loop.records.facts()).toMatchObject([{ type: 'failed', failed: { kind: 'unreachable' } }]);
  });
});

describe('a subscribe sent and not answered in time, which the app may have made', () => {
  it('is tried again only after the resync period, where its method makes a new subscription', async () => {
    const loop = loopThrough(ofEachSubscription);
    loop.app.fails('timed_out', 1);

    expect(await roundAt(portsOf(loop, {}), startedAt)).toEqual({ nextDueAt: startedAt + resyncedAfterMs });
  });

  it('is tried again after the usual wait, where its method is idempotent', async () => {
    const loop = loopThrough({ ...ofEachSubscription, subscribe: { ...ofEachSubscription.subscribe, method: 'PUT' } });
    loop.app.fails('timed_out', 1);
    const { nextDueAt: retryAt = 0 } = await roundAt(portsOf(loop, {}), startedAt);

    expect(retryAt - startedAt).toBeLessThanOrEqual(socketBackoff.firstWaitMs * (1 + socketBackoff.spread));
  });
});

describe('an entry that changes once a subscription has lapsed', () => {
  it('makes it again with no call to remove the one the app has already ended', async () => {
    const loop = loopThrough(intoAQueue);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    const longer = declaredDestinations({ ...intoAQueue, lease_seconds: 604_800 });
    loop.connections.becomes({ ...tracker, connected, destinations: longer });
    await roundAt(ports, startedAt + 4 * 24 * anHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made', 'removed', 'made']);
  });
});

describe('a failure that passes, where the destination does not renew', () => {
  it('records nothing when subscribing again in place of a renewal, and is tried again after its wait', async () => {
    const loop = loopThrough(leasedWithoutRenewal, { reusesIds: true });
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.app.fails('unreachable', 1);
    const { nextDueAt: retried = 0 } = await roundAt(ports, startedAt + halfAnHour);
    await roundAt(ports, retried);

    expect(loop.app.acts()).toEqual(['subscribe', 'subscribe', 'subscribe']);
    expect(loop.records.facts().map(({ type }) => type)).toEqual(['made']);
    expect(loop.records.rows()).toMatchObject([{ positions: { failures: 0, lapsesAt: retried + anHour } }]);
  });
});

describe('what the record cannot hold', () => {
  it('is not arranged where it is the topic, and is unsubscribed at once where it is the id the app answers', async () => {
    const loop: Loop = { ...loopThrough(ofEachSubscription), records: inMemoryRecords(5) };
    loop.askers[0]?.becomes(inAlpha, { ...inAlpha, topic: 'alphabet' });
    await roundAt(portsOf(loop, {}), startedAt);
    await roundAt(portsOf(loop, {}), startedAt + anHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe']);
    expect(loop.app.held()).toEqual([]);
    expect(loop.records.facts()).toMatchObject([
      { type: 'failed', key: inAlpha, failed: { kind: 'tool_error', because: 'unreadable' } },
    ]);
    expect(loop.secrets.kept().size).toBe(0);
  });
});
