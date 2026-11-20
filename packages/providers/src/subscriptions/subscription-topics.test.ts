import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ofEachSubscription } from '../testing/event-destinations.ts';
import { declaredDestinations, postsOfEachRoom } from '../testing/subscription-apps.ts';
import {
  aPostIn,
  alpha,
  changing,
  loopOver,
  portsOf,
  roundAt,
  startedAt,
  waitingIn,
  type Changing,
  type Loop,
} from '../testing/subscription-loops.ts';
import type { SubscriptionLoopPorts } from './subscription-ports.ts';
import {
  requestsAskerOf,
  triggersAskerOf,
  type ConnectionTrigger,
  type WaitingRequest,
} from './subscription-topics.ts';

const anHour = 3_600_000;

const connected = '2026-10-01T08:00:00.000Z';

const byRequest = declaredDestinations(ofEachSubscription);

const waiting = [
  { connection: 'tracker', with: { project: 'site' }, sent: { conversation: 'C0123', id: '1699.1' } },
  { connection: 'tracker', with: {}, sent: { conversation: 'C0123', id: '1699.2' } },
  { connection: 'chat', with: { project: 'site' }, sent: { conversation: 'C0456', id: '1699.3' } },
];

function askerCounting(read: () => void) {
  return requestsAskerOf(() =>
    Effect.sync(() => {
      read();
      return waiting;
    }),
  );
}

describe('the requests the loop asks', () => {
  it('are not read while no destination is arranged', async () => {
    const reads = { count: 0 };

    expect(
      await Effect.runPromise(
        askerCounting(() => {
          reads.count += 1;
        })({ ...alpha, arranged: new Map() }),
      ),
    ).toEqual([]);
    expect(reads.count).toBe(0);
  });

  it('name the topic of each request waiting through a connection whose destination is arranged, where it renders', async () => {
    const reads = { count: 0 };
    const arranged = new Map(byRequest.map((each) => ['tracker', each]));

    expect(
      await Effect.runPromise(
        askerCounting(() => {
          reads.count += 1;
        })({ ...alpha, arranged }),
      ),
    ).toEqual([{ connection: 'tracker', topic: 'site' }]);
    expect(reads.count).toBe(1);
  });
});

interface Asked {
  readonly loop: Loop;
  readonly ports: SubscriptionLoopPorts;
  readonly saved: Changing<ConnectionTrigger>;
  readonly waits: Changing<WaitingRequest>;
}

function askedOf(saved: readonly ConnectionTrigger[], waits: readonly WaitingRequest[] = []): Asked {
  const loop = loopOver([{ connection: 'tracker', connected, destinations: postsOfEachRoom }]);
  const asked = { saved: changing(...saved), waits: changing(...waits) };
  const askers = [
    requestsAskerOf(() => Effect.sync(asked.waits.now)),
    triggersAskerOf(() => Effect.sync(asked.saved.now)),
  ];
  return { loop, ports: { ...portsOf(loop, {}), askers }, ...asked };
}

describe('the triggers the loop asks', () => {
  it('make the loop subscribe once for a saved trigger that names a connection, and a round after it changes nothing', async () => {
    const { loop, ports } = askedOf([aPostIn('site')]);
    await roundAt(ports, startedAt);
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toEqual(['subscribe']);
    expect(loop.records.rows()).toMatchObject([{ connection: 'tracker', topic: 'site', made: { id: 'hook-1' } }]);
  });

  it('share one subscription with every other trigger and request waiting in the same place', async () => {
    const { loop, ports } = askedOf([aPostIn('site'), aPostIn('site')], [waitingIn('site')]);
    await roundAt(ports, startedAt);

    expect(loop.app.acts()).toEqual(['subscribe']);
    expect(loop.records.rows().map(({ topic }) => topic)).toEqual(['site']);
  });

  it('end it once no trigger asks, and subscribe again once one asks again', async () => {
    const { loop, ports, saved } = askedOf([aPostIn('site')]);
    await roundAt(ports, startedAt);
    saved.becomes();
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe']);
    saved.becomes(aPostIn('site'));
    await roundAt(ports, startedAt + 2 * anHour);
    expect(loop.app.acts()).toEqual(['subscribe', 'unsubscribe', 'subscribe']);
  });

  it('never end a subscription that a waiting request still holds', async () => {
    const { loop, ports, saved } = askedOf([aPostIn('site')], [waitingIn('site')]);
    await roundAt(ports, startedAt);
    saved.becomes();
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toEqual(['subscribe']);
    expect(loop.records.rows()).toMatchObject([{ topic: 'site', made: { id: 'hook-1' } }]);
  });

  it('end it, without a call, once the connection they name is gone', async () => {
    const { loop, ports } = askedOf([aPostIn('site')]);
    await roundAt(ports, startedAt);
    loop.connections.becomes();
    await roundAt(ports, startedAt + anHour);

    expect(loop.app.acts()).toEqual(['subscribe']);
    expect(loop.records.rows()).toEqual([]);
  });
});

describe('the topics the triggers ask for', () => {
  const arranged = new Map([
    ...postsOfEachRoom.map((each) => ['tracker', each] as const),
    ...byRequest.map((each) => ['mail', each] as const),
  ]);

  function askedFor(...triggers: readonly ConnectionTrigger[]) {
    return Effect.runPromise(triggersAskerOf(() => Effect.succeed(triggers))({ ...alpha, arranged }));
  }

  it('are the topic the destination names for a request in the same place, by what the entry declares', async () => {
    expect(await askedFor(aPostIn('site'))).toEqual(
      await Effect.runPromise(requestsAskerOf(() => Effect.succeed([waitingIn('site')]))({ ...alpha, arranged })),
    );
  });

  it('are none for a trigger that names no place, a connection not arranged, a type mapped without one, or a place past the bound', async () => {
    expect(
      await askedFor(
        aPostIn(),
        aPostIn('site', 'chat'),
        aPostIn('site', 'mail'),
        { connection: 'tracker', type: 'com.example.chat.room.opened', subject: 'site' },
        aPostIn('é'.repeat(129)),
      ),
    ).toEqual([]);
  });

  it('are not read while no destination is arranged', async () => {
    const reads = { count: 0 };
    const asker = triggersAskerOf(() =>
      Effect.sync(() => {
        reads.count += 1;
        return [aPostIn('site')];
      }),
    );

    expect(await Effect.runPromise(asker({ ...alpha, arranged: new Map() }))).toEqual([]);
    expect(reads.count).toBe(0);
  });
});
