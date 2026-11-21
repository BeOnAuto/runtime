import { defaultOrg } from '@on.auto/openid-connect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { personSigningIn } from '../sign-in/person-signing-in.ts';
import { servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import {
  delivered,
  eventsPathOf,
  hookMadeAt,
  loggedLines,
  receivingAt,
  roomsDelivery,
  roomsServer,
  servedWithRooms,
  signedWith,
  takenOnceRecorded,
  theRoom,
  theWebhookUrl,
} from '../testing/interaction-servers/room-events.ts';
import { postedInARoom, servedListeningInTheRoom } from '../testing/interaction-servers/shipped-rooms.ts';
import { connectionsIn } from '../testing/servers/connected-servers.ts';
import { connectionsAllowing } from '../testing/servers/loopback-connections.ts';
import { receivingOtlp } from '../testing/telemetry/otlp-receiver.ts';
import { until } from '../testing/waiting/until.ts';

const arrivedLine = '"outcome":"arrived"';

const alpha = `/v1/orgs/${defaultOrg}/playbooks/alpha`;

const eventsOf = (playbook: string, connection: string) => eventsPathOf(playbook, connection, defaultOrg);

async function signingPeopleIn() {
  const signing = await personSigningIn();
  return {
    signingIn: { ...signing.environment, WEBHOOK_URL: theWebhookUrl },
    asThePerson: { key: (origin: string) => signing.tokenAt(origin, 'Ada') },
  };
}

async function signingInWithRooms(environment: Readonly<Record<string, string>> = {}) {
  const rooms = await roomsServer();
  const { signingIn, asThePerson } = await signingPeopleIn();
  const server = await servedWithRooms(rooms, { ...signingIn, ...environment }, asThePerson, defaultOrg);
  return { rooms, server };
}

async function tracedWithRooms() {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  const { rooms, server } = await signingInWithRooms({
    OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
  });
  return { receiver, rooms, server };
}

describe('a server that signs people in, given WEBHOOK_URL, whose request waits through a connection that declares a webhook per subscription', () => {
  it('subscribes at its service with its events address, which ends with the connection’s id, shows it among the playbook’s events, and takes a delivery the service signs with the secret it gave at that address', async () => {
    const lines = loggedLines();
    const { receiver, rooms, server } = await tracedWithRooms();
    await server.ask('approve-brief');

    const hook = await hookMadeAt(rooms);
    const roomsId = String(new URL(hook.callback).searchParams.get('connection_id'));
    const listed = await server.call('GET', connectionsIn(defaultOrg));
    const taken = await takenOnceRecorded(server, hook);
    const arrived = await until(lines, (seen) => seen.some((line) => line.includes(arrivedLine)));
    const made = await server.call('GET', `${alpha}/events?type=event_subscription_made`);
    const kept = [
      JSON.stringify((await server.call('GET', `${alpha}/events`)).body),
      JSON.stringify((await server.call('GET', `${alpha}/interactions`)).body),
    ];
    await server.stop();
    const exported = receiver.received();

    expect(hook).toMatchObject({
      room: theRoom,
      callback: `${theWebhookUrl}${eventsOf('alpha', 'rooms')}?connection_id=${roomsId}`,
    });
    const roomsAmongThem: unknown = expect.arrayContaining([expect.objectContaining({ id: roomsId, name: 'rooms' })]);
    expect(listed.body).toMatchObject({ connections: roomsAmongThem });
    expect(made).toMatchObject({
      status: 200,
      body: { events: [{ type: 'event_subscription_made', data: { connection: 'rooms', topic: theRoom } }] },
    });
    expect(taken).toBe('200 ');
    expect(arrived.filter((line) => line.includes(arrivedLine))).toEqual([
      expect.stringContaining('"connection":"rooms"'),
    ]);
    expect(exported.filter(({ path }) => path.endsWith('/v1/traces'))).not.toEqual([]);
    expect(
      [...kept, ...lines(), ...exported.map(({ text }) => text)].filter((text) => text.includes(hook.secret)),
    ).toEqual([]);
  });
});

describe('a server given WEBHOOK_URL whose workflow’s trigger names a connection that reports events', () => {
  it('subscribes for the place the trigger names, takes in once the event a delivery proven by that subscription carries, and records nothing of it sent again', async () => {
    const lines = loggedLines();
    const rooms = await roomsServer();
    const { signingIn, asThePerson } = await signingPeopleIn();
    const server = await servedListeningInTheRoom(rooms.url, signingIn, asThePerson, defaultOrg);
    const hook = await hookMadeAt(rooms);
    const text = 'a post no line of the log may hold';
    const posted = JSON.stringify({ kind: 'posted', room: theRoom, id: 'm-1', text });

    const taken = await takenOnceRecorded(server, hook, posted);
    const { pathname, search } = new URL(hook.callback);
    const sentAgain = await delivered(
      server,
      `${pathname}${search}`,
      signedWith(hook.secret, 'hook-7', posted),
      posted,
    );
    const recorded = await server.call('GET', `${alpha}/events?type=event_published`);

    expect(hook.room).toBe(theRoom);
    expect([taken, sentAgain]).toEqual(['200 ', '200 ']);
    expect(lines().filter((line) => line.includes(text))).toEqual([]);
    const theEvent = { event_type: postedInARoom, event_id: '%23approvals-ada/m-1', source: '/connections/rooms' };
    expect(recorded).toMatchObject({
      status: 200,
      body: {
        events: [{ type: 'event_published', data: { ...theEvent, subject: theRoom, data: { text } } }],
      },
    });
  });
});

describe('a delivery to the events address that no subscription of the playbook proves', () => {
  it('is refused alike, signed with another secret, for another playbook, through a connection holding no subscription or unknown, or naming a subscription other than the one whose secret signs it', async () => {
    const { rooms, server } = await signingInWithRooms();
    await server.ask('approve-brief');
    const hook = await hookMadeAt(rooms);
    await takenOnceRecorded(server, hook);
    const boards = { 'x-boards-event': 'card', 'x-boards-token': hook.secret };

    const refused = [
      await delivered(server, eventsOf('alpha', 'rooms'), signedWith('whsec_another-secret')),
      await delivered(server, eventsOf('beta', 'rooms'), signedWith(hook.secret)),
      await delivered(server, eventsOf('alpha', 'boards'), boards),
      await delivered(server, eventsOf('alpha', 'billing'), signedWith(hook.secret)),
      await delivered(server, eventsOf('alpha', 'rooms'), signedWith(hook.secret, 'hook-8')),
    ];

    expect(new Set(refused).size).toBe(1);
    expect(refused[0]).toMatch(/^401 /u);
    expect(refused.filter((answer) => answer.includes(hook.secret))).toEqual([]);
  });
});

describe('a connection whose entry declares a handshake that comes before any secret', () => {
  it('answers the handshake a connection of another shape declares before any secret exists, as WebSub verifies intent', async () => {
    const { server } = await signingInWithRooms();
    const asked = `${eventsOf('alpha', 'boards')}?hub.mode=subscribe&hub.challenge=c-81`;

    const answer = await fetch(`${server.origin}${asked}`, { method: 'POST' });

    expect(`${answer.status} ${await answer.text()}`).toBe('200 c-81');
  });
});

describe('a self-hosted runtime that nothing outside can reach', () => {
  it('serves no events address, arranges no webhook, and reads the replies of a request on its timer', async () => {
    const rooms = await roomsServer();
    const server = await servedWithRooms(rooms, {});
    const asked = await server.ask('approve-brief');
    await until(
      () => rooms.chat.posted(),
      (posted) => posted.length > 0,
    );
    rooms.chat.reply({ channel: theRoom, user: 'ada', text: 'approve', at: Date.now() / 1000 });

    const settled = await server.settled(asked);
    const answer = await server.call('POST', eventsPathOf('alpha', 'rooms'), { body: {} });

    expect(settled).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
    expect(answer).toMatchObject({ status: 404, body: { reason: 'not_found', detail: 'No route matches the path' } });
    expect(rooms.received().filter(({ tool }) => tool === 'create_hook')).toEqual([]);
  });
});

describe('the events address of a server that signs people in, given WEBHOOK_URL, that receives nothing over http', () => {
  it('answers no route, as CONNECTIONS_RECEIVE_EVENTS or receive_events turns it off', async () => {
    const rooms = await roomsServer();
    const { signingIn, asThePerson } = await signingPeopleIn();
    const servers = [
      await servingInteractions(
        roomsDelivery,
        { ...receivingAt(rooms.url, signingIn), CONNECTIONS_RECEIVE_EVENTS: '' },
        asThePerson,
        defaultOrg,
      ),
      await servingInteractions(
        roomsDelivery,
        { ...connectionsAllowing(['127.0.0.1'], { receive_events: [] }), ...signingIn },
        asThePerson,
        defaultOrg,
      ),
    ];

    const answers = await Promise.all(
      servers.map((server) => server.call('POST', eventsOf('alpha', 'rooms'), { body: {} })),
    );

    expect(answers.map(({ status }) => status)).toEqual([404, 404]);
  });
});
