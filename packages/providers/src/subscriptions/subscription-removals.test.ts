import { describe, expect, it } from 'vitest';

import { ofEachSubscription } from '../testing/event-destinations.ts';
import { answeringItsSecret, declaredDestinations } from '../testing/subscription-apps.ts';
import { loopOver, portsOf, roundAt, startedAt, type Loop } from '../testing/subscription-loops.ts';
import type { SubscriptionKey } from './subscription-ports.ts';

const connected = '2026-10-01T08:00:00.000Z';

const anHour = 3_600_000;

const inAlpha: SubscriptionKey = { connection: 'tracker', topic: 'alpha' };

const inBeta: SubscriptionKey = { connection: 'tracker', topic: 'beta' };

const trackerId = 'id-of-tracker';

function loopThrough(written: object): Loop {
  const destinations = declaredDestinations(written);
  return loopOver([{ id: trackerId, connection: 'tracker', connected, destinations }], [inAlpha]);
}

function factsOf(loop: Loop): readonly string[] {
  return loop.records.facts().map(({ type, key }) => `${type} ${key.topic}`);
}

describe('a subscription the app no longer has, which nobody wants', () => {
  it('is removed, with its secret, once the app answers its removal that it has none', async () => {
    const loop = loopThrough(ofEachSubscription);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);

    expect(loop.secrets.kept().size).toBe(1);

    loop.askers[0]?.becomes();
    loop.app.fails('not_found', 1);

    expect(await roundAt(ports, startedAt + anHour)).toEqual({});
    expect(loop.records.rows()).toEqual([]);
    expect(factsOf(loop)).toEqual(['made alpha', 'removed alpha']);
    expect(loop.secrets.kept().size).toBe(0);
  });

  it('frees its place under the bound, so another topic is subscribed', async () => {
    const loop = loopThrough(ofEachSubscription);
    const ports = portsOf(loop, { mostPerConnection: 1 });
    await roundAt(ports, startedAt);
    loop.askers[0]?.becomes(inBeta);
    loop.app.fails('not_found', 1);

    expect(await roundAt(ports, startedAt + anHour)).toEqual({ nextDueAt: startedAt + anHour });

    await roundAt(ports, startedAt + anHour);

    expect(factsOf(loop)).toEqual(['made alpha', 'removed alpha', 'made beta']);
    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe', 'subscribe']);
  });
});

describe('a removal the app refuses through a tool, of a subscription nobody wants', () => {
  it('forgets the subscription and its secret rather than holding them, so the place is free', async () => {
    const loop = loopThrough(answeringItsSecret);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);

    expect(loop.secrets.kept().size).toBe(1);

    loop.askers[0]?.becomes();
    loop.app.fails('tool_error', 1);
    await roundAt(ports, startedAt + anHour / 4);

    expect(loop.records.rows()).toEqual([]);
    expect(factsOf(loop)).toEqual(['made alpha', 'removed alpha']);
    expect(loop.secrets.kept().size).toBe(0);
  });

  it('still holds one that connecting again can mend, as a permission the sign-in lacks', async () => {
    const loop = loopThrough(ofEachSubscription);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.askers[0]?.becomes();
    loop.app.fails('scope_lacking', 1);
    await roundAt(ports, startedAt + anHour);

    expect(factsOf(loop)).toEqual(['made alpha', 'failed alpha']);
    expect(loop.secrets.kept().size).toBe(1);
  });
});

describe('the removal of a subscription being replaced, answered that the app has none', () => {
  it('is a removal done, and the new subscription is made', async () => {
    const loop = loopThrough(ofEachSubscription);
    const ports = portsOf(loop, {});
    await roundAt(ports, startedAt);
    loop.connections.becomes({
      id: trackerId,
      connection: 'tracker',
      connected,
      destinations: declaredDestinations({ ...ofEachSubscription, lease_seconds: 7200 }),
    });
    loop.app.fails('not_found', 1);
    await roundAt(ports, startedAt + anHour);

    expect(factsOf(loop)).toEqual(['made alpha', 'removed alpha', 'made alpha']);
    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe', 'subscribe']);
  });
});
