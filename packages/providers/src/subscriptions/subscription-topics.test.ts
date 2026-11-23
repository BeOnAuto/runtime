import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Destination } from '../events/destination-fields.ts';
import { aPost, mapping, ofEachSubscription, ofTheApp, overASocket, roomType } from '../testing/event-destinations.ts';
import {
  declaredDestinations,
  placedPostTypes,
  postsOfEachRoom,
  reportedDestinations,
} from '../testing/subscription-apps.ts';
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
import { destinationOf } from '../testing/subscription-services.ts';
import type { SubscriptionLoopPorts } from './subscription-ports.ts';
import {
  requestsAskerOf,
  topicOf,
  triggersAskerOf,
  triggerTopicsOf,
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
        })({ ...alpha, taken: new Map() }),
      ),
    ).toEqual([]);
    expect(reads.count).toBe(0);
  });

  it('name the topic of each request waiting through a connection whose destination is arranged, where it renders, with that destination', async () => {
    const reads = { count: 0 };
    const taken = new Map([['tracker', byRequest]]);

    expect(
      await Effect.runPromise(
        askerCounting(() => {
          reads.count += 1;
        })({ ...alpha, taken }),
      ),
    ).toEqual([{ connection: 'tracker', topic: 'site', destination: byRequest[0] }]);
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
  const loop = loopOver([{ id: 'id-of-tracker', connection: 'tracker', connected, destinations: postsOfEachRoom }]);
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
  const taken = new Map([
    ['tracker', postsOfEachRoom],
    ['mail', byRequest],
  ]);

  function askedFor(...triggers: readonly ConnectionTrigger[]) {
    return Effect.runPromise(triggersAskerOf(() => Effect.succeed(triggers))({ ...alpha, taken }));
  }

  it('are the topic the destination names for a request in the same place, by what the entry declares', async () => {
    expect(await askedFor(aPostIn('site'))).toEqual(
      await Effect.runPromise(requestsAskerOf(() => Effect.succeed([waitingIn('site')]))({ ...alpha, taken })),
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

    expect(await Effect.runPromise(asker({ ...alpha, taken: new Map() }))).toEqual([]);
    expect(reads.count).toBe(0);
  });
});

const placedRooms = [...placedPostTypes.slice(0, 1), { ...roomType, subject: { title: 'Room', required: true } }];

const roomsListed = {
  type: roomType.type,
  when: {},
  id: ['$message.payload#/id'],
  subject: '$message.payload#/room',
  topic: 'rooms in {{ subject }}',
};

const [postsByHook, roomsByCheck] = reportedDestinations(
  placedRooms,
  mapping(
    { ...ofEachSubscription, topic: 'posts in {{ with.project }}' },
    { ...aPost, topic: 'posts in {{ subject }}' },
  ),
  {
    type: 'polling',
    read: { tool: 'list_rooms', with: { room: '{{ topic }}' }, list: '/rooms', order: 'oldest_first', cursor: '/at' },
    events: [roomsListed],
  },
);

const byTheApp = reportedDestinations(placedRooms, mapping(ofTheApp, aPost));

function aRoomIn(subject: string): ConnectionTrigger {
  return { connection: 'tracker', type: roomType.type, subject };
}

async function askedThrough(...listed: readonly (Destination | undefined)[]) {
  const asking = { ...alpha, taken: new Map([['tracker', listed.filter((each) => each !== undefined)]]) };
  return [
    ...(await Effect.runPromise(triggersAskerOf(() => Effect.succeed([aPostIn('site'), aRoomIn('site')]))(asking))),
    ...(await Effect.runPromise(requestsAskerOf(() => Effect.succeed([waitingIn('site')]))(asking))),
  ];
}

function topicsOn(...destinations: readonly Destination[]) {
  return Effect.runPromise(
    Effect.forEach(destinations, (destination) => triggerTopicsOf(destination, aPostIn('site'))),
  );
}

describe('the destination each asked place is heard through, where an entry lists several', () => {
  it('is, for a trigger, the first destination taken whose events carry its type, and for a request the first taken', async () => {
    expect(await askedThrough(postsByHook, roomsByCheck)).toEqual([
      { connection: 'tracker', topic: 'posts in site', destination: postsByHook },
      { connection: 'tracker', topic: 'rooms in site', destination: roomsByCheck },
      { connection: 'tracker', topic: 'posts in site', destination: postsByHook },
    ]);
  });

  it('is none for a type no destination taken carries, nor for a request where the first taken gives a place no topic', async () => {
    expect(await askedThrough(roomsByCheck)).toEqual([
      { connection: 'tracker', topic: 'rooms in site', destination: roomsByCheck },
    ]);
  });

  it('is rendered from no template of a destination that maps no event, or maps the type without a topic', async () => {
    expect(await topicsOn(...byRequest, ...byTheApp)).toEqual([[], []]);
  });

  it('is none where the first destination taken that carries the type is heard without a subscription', async () => {
    expect(await askedThrough(...byTheApp, postsByHook)).toEqual([]);
  });
});

describe('the topic of a request', () => {
  const placed = { with: { project: 'site', owner: 'acme' }, sent: { conversation: 'C0123', id: '1699.1' } };

  const perSubscription = destinationOf(ofEachSubscription);

  const renderedOf = (topic: string) => Effect.runPromise(topicOf({ ...perSubscription, topic }, placed));

  it('is its destination’s topic, rendered over the arguments of the call that delivered it and where it was sent', async () => {
    expect(await renderedOf('{{ with.owner }}/{{ with.project }}')).toBe('acme/site');
    expect(await renderedOf('{{ sent.conversation }}:{{ sent.id }}')).toBe('C0123:1699.1');
  });

  it('is none where the destination declares no topic, the template does not render, or renders nothing or too much', async () => {
    expect(await Effect.runPromise(topicOf(destinationOf(overASocket, 'websocket'), placed))).toBeUndefined();
    expect(await renderedOf('{{ with.project')).toBeUndefined();
    expect(await renderedOf('{{ with.missing }}')).toBeUndefined();
    expect(await renderedOf(`{{ with.project }}${'x'.repeat(300)}`)).toBeUndefined();
  });
});
