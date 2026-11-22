import { ConnectionEventSchema, connectionsStreamOfOrg } from '@on.auto/connections';
import { defaultOrg } from '@on.auto/openid-connect';
import type { Ledger } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  delivered,
  roomsServer,
  signedWith,
  takenOnceRecorded,
  theRoom,
  theRoomsName,
} from '../testing/interaction-servers/room-events.ts';
import { servedNamingTheRoom } from '../testing/interaction-servers/shipped-rooms.ts';
import { whenSwept } from '../testing/servers/workflow-server.ts';
import { signingPeopleIn } from '../testing/webhooks/signed-in-rooms.ts';
import { hookSweptAt } from '../testing/webhooks/swept-hooks.ts';

const alpha = `/v1/orgs/${defaultOrg}/playbooks/alpha`;

type ConnectionFact = typeof ConnectionEventSchema.Type;

const noFactYet: readonly ConnectionFact[] = [];

const factsRead = {
  initialState: noFactYet,
  evolve: (facts: readonly ConnectionFact[], fact: ConnectionFact) => [...facts, fact],
  eventSchema: ConnectionEventSchema,
};

interface NamedPlace {
  readonly subject: string;
  readonly name: string;
  readonly by: string;
}

async function placesNamedIn(ledger: Ledger['Service']): Promise<readonly NamedPlace[]> {
  const { state } = await Effect.runPromise(ledger.load(connectionsStreamOfOrg(defaultOrg), factsRead));
  return state.flatMap(({ type, data, context }) =>
    type === 'connection_place_named' ? [{ subject: data.subject, name: data.name, by: context.by }] : [],
  );
}

function calledOf(rooms: Awaited<ReturnType<typeof roomsServer>>, tool: string) {
  return rooms.received().filter((received) => received.tool === tool);
}

describe('a self-hosted runtime that nothing outside can reach, whose workflow’s trigger names a room of a connection whose entry says how to read its name', () => {
  it('reads the name of the room through the connection’s tool marked reads, arranges nothing, and records the name on the org’s connections', async () => {
    const rooms = await roomsServer();
    const { signingIn, asThePerson } = await signingPeopleIn();
    const { WEBHOOK_URL: _noAddress, ...unreachable } = signingIn;
    const { server, ledger } = await servedNamingTheRoom(rooms.url, unreachable, asThePerson, defaultOrg);

    const named = await whenSwept(
      server,
      () => placesNamedIn(ledger),
      (facts) => facts.length > 0,
    );

    expect(named).toEqual([{ subject: theRoom, name: theRoomsName, by: 'runtime' }]);
    expect(rooms.received().map(({ tool, arguments: given }) => [tool, given])).toEqual([
      ['room_info', { room: theRoom }],
    ]);
  });
});

const RunsSchema = Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) });

describe('a server given WEBHOOK_URL whose workflow’s trigger names a room whose name cannot be read', () => {
  it('starts one run of a delivery proven by the subscription, once, and keeps no name', async () => {
    const rooms = await roomsServer('fails');
    const { signingIn, asThePerson } = await signingPeopleIn();
    const { server, ledger } = await servedNamingTheRoom(rooms.url, signingIn, asThePerson, defaultOrg);
    const hook = await hookSweptAt(server, rooms);
    await whenSwept(
      server,
      () => calledOf(rooms, 'room_info').length,
      (called) => called > 0,
    );
    const posted = JSON.stringify({ kind: 'posted', room: theRoom, id: 'm-1', text: 'a post' });

    const taken = await takenOnceRecorded(server, hook, posted);
    const { pathname, search } = new URL(hook.callback);
    const sentAgain = await delivered(
      server,
      `${pathname}${search}`,
      signedWith(hook.secret, 'hook-7', posted),
      posted,
    );
    const started = await whenSwept(
      server,
      async () => Schema.decodeUnknownSync(RunsSchema)((await server.call('GET', `${alpha}/runs`)).body).runs,
      (runs) => runs.length > 0,
    );

    expect([taken, sentAgain]).toEqual(['200 ', '200 ']);
    expect(started).toHaveLength(1);
    expect(await placesNamedIn(ledger)).toEqual([]);
  });
});
