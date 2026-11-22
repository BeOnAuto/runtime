import { Effect, Exit, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { theRoomsNameCall } from '../testing/place-name-calls.ts';
import { alpha, loopOver, portsOf, startedAt } from '../testing/subscription-loops.ts';
import {
  aService as aServiceOfTools,
  answeredNothing,
  answeredWith,
  place,
  rateLimited,
  type FakeService,
} from '../testing/subscription-services.ts';
import { subscriptionCallsOf } from './subscription-calls.ts';
import { failedBecause, type SubscriptionCallFailed, type SubscriptionFailedBecause } from './subscription-failed.ts';
import { placeNamesReadOf, placeNamesReadWith } from './subscription-place-names.ts';
import type { LoopConnection, NamedPlace, SubscriptionCalls } from './subscription-ports.ts';

const readsTheRoom = { reads: ['room_info'] };

function onTheClock<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(
    TestClock.setTime(startedAt).pipe(Effect.andThen(Effect.result(effect)), Effect.provide(TestClock.layer())),
  );
}

function namedBy(service: FakeService, mostCharacters?: number) {
  const calls =
    mostCharacters === undefined
      ? subscriptionCallsOf(service.ports)
      : subscriptionCallsOf(service.ports, mostCharacters);
  return onTheClock(calls.name({ name: theRoomsNameCall, place, subject: 'C0123' }));
}

const unreadable = Result.fail(expect.objectContaining({ kind: 'tool_error', because: 'unreadable' }));

const titled = (title: string) => answeredWith({ room: { title } });

describe('the call that reads the name of a place', () => {
  it('asks the tool the entry declares, marked reads, with its arguments written from the place, keeping no content, and reads the name at the pointer', async () => {
    const service = aServiceOfTools([titled('support')], readsTheRoom);
    const reference = { server: 'tracker', tool: 'room_info' };
    const input = { room: 'C0123' };

    expect(await namedBy(service)).toEqual(Result.succeed('support'));
    expect(service.sent()).toEqual([
      {
        tool: {
          org: 'acme',
          playbook: 'alpha',
          reference,
          input,
          meta: {},
          recordContent: false,
          requiredMark: 'reads',
        },
      },
    ]);
  });

  it('is refused unsent where the tool is not marked reads, which fails it as a refusal of the tool', async () => {
    const service = aServiceOfTools([titled('support')]);
    const notReads = Result.fail(expect.objectContaining({ kind: 'tool_error', because: 'tool_not_read_only' }));

    expect([await namedBy(service), service.sent()]).toEqual([notReads, []]);
  });

  it.each([
    ['no name at the pointer', answeredWith({ room: {} })],
    ['an empty name', titled('')],
    ['no answer', answeredNothing],
  ] as const)('fails unreadable for %s', async (_answered, answer) => {
    expect(await namedBy(aServiceOfTools([answer], readsTheRoom))).toEqual(unreadable);
  });

  it('passes on how the call failed where the service did not answer', async () => {
    const service = aServiceOfTools([rateLimited], readsTheRoom);

    expect(await namedBy(service)).toEqual(Result.fail(expect.objectContaining({ kind: 'unreachable' })));
  });
});

describe('the longest name the call reads', () => {
  it('is the most it is given, a name one character over unreadable', async () => {
    const service = aServiceOfTools([titled('abc'), titled('abcd')], readsTheRoom);

    expect([await namedBy(service, 3), await namedBy(service, 3)]).toEqual([Result.succeed('abc'), unreadable]);
  });

  it('is 200 characters by default', async () => {
    const service = aServiceOfTools([titled('n'.repeat(200)), titled('n'.repeat(201))], readsTheRoom);

    expect([await namedBy(service), await namedBy(service)]).toEqual([Result.succeed('n'.repeat(200)), unreadable]);
  });
});

describe('the fake service a call is sent to', () => {
  it('refuses unsent, as the tool access does, a call that needs a tool marked reads of a tool it does not mark so', async () => {
    const service = aServiceOfTools([answeredWith({})], readsTheRoom);
    const called = { org: 'acme', playbook: 'alpha', input: {}, meta: {}, requiredMark: 'reads' } as const;
    const sentOnce = (tool: string) =>
      Effect.runPromise(service.ports.callOnce({ ...called, reference: { server: 'tracker', tool } }));

    expect([(await sentOnce('room_info')).kind, await sentOnce('create_room')]).toEqual([
      'answered',
      expect.objectContaining({ kind: 'unopened', refused: 'tool_not_read_only' }),
    ]);
    expect(service.sent()).toHaveLength(1);
  });
});

const connected = '2026-10-01T08:00:00.000Z';

const posted = 'com.example.chat.post';

function naming(connection: string, named: readonly string[] = []): LoopConnection {
  const placeNaming = [{ type: posted, name: theRoomsNameCall, named }];
  return { id: `id-of-${connection}`, connection, connected, destinations: [], placeNaming };
}

const notConnected: LoopConnection = { id: 'id-of-mail', connection: 'mail', destinations: [] };

interface Trigger {
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
}

function postedIn(subject?: string, connection = 'chat'): Trigger {
  return subject === undefined ? { connection, type: posted } : { connection, type: posted, subject };
}

type Answer = { readonly name: string } | { readonly failed: SubscriptionFailedBecause };

interface Recorded extends NamedPlace {
  readonly connection: string;
}

const anHour = 3_600_000;

function answeredFor(answers: Readonly<Record<string, Answer>>, subject: string) {
  const answer = answers[subject] ?? { name: `room ${subject}` };
  return 'name' in answer ? Effect.succeed(answer.name) : Effect.fail(failedBecause(answer.failed));
}

function aService(answers: Readonly<Record<string, Answer>> = {}, stepMs = 0) {
  const asked: string[] = [];
  const recorded: Recorded[] = [];
  const calls: Pick<SubscriptionCalls, 'name'> = {
    name: ({ name, place: where, subject }): Effect.Effect<string, SubscriptionCallFailed> =>
      Effect.andThen(
        TestClock.adjust(stepMs),
        Effect.suspend(() => {
          asked.push(`${where.connection} ${subject} ${name.tool}`);
          return answeredFor(answers, subject);
        }),
      ),
  };
  const ports = {
    placeNamed: (_playbook: unknown, { id }: { readonly id: string }, named: NamedPlace) =>
      Effect.sync(() => {
        recorded.push({ connection: id, ...named });
      }),
  };
  return { read: placeNamesReadWith(ports, calls), asked, recorded };
}

function readAt<A>(effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(
    TestClock.setTime(startedAt).pipe(Effect.andThen(effect), Effect.provide(TestClock.layer())),
  );
}

const roomOpened: Trigger = { connection: 'chat', type: 'com.example.chat.room.opened', subject: 'C1' };

describe('the names a round owes the places its triggers name', () => {
  it.each([
    ['a trigger that names no place', [naming('chat')], [postedIn()]],
    ['a type whose entry declares no name', [naming('chat')], [roomOpened]],
    ['a connection not connected, which carries no naming', [notConnected], [postedIn('C1', 'mail')]],
    ['a place already named for the connecting', [naming('chat', ['C1'])], [postedIn('C1')]],
    ['a connection the playbook is not served by', [naming('chat')], [postedIn('C1', 'elsewhere')]],
  ] as const)('are none for %s', async (_owed, connections, triggers) => {
    const service = aService();
    await readAt(service.read(alpha, connections, triggers));

    expect([service.asked, service.recorded]).toEqual([[], []]);
  });

  it('are one read for a place, however many triggers name it', async () => {
    const service = aService();
    await readAt(service.read(alpha, [naming('chat')], [postedIn('C1'), postedIn('C1'), postedIn('C2')]));

    expect(service.asked).toEqual(['chat C1 room_info', 'chat C2 room_info']);
  });
});

describe('a name a round reads', () => {
  it('is handed to the recorder once, with the connection, its connecting, the type and the place', async () => {
    const service = aService({ C1: { name: 'support' } });
    await readAt(service.read(alpha, [naming('chat')], [postedIn('C1')]));

    expect(service.recorded).toEqual([{ connection: 'id-of-chat', type: posted, subject: 'C1', name: 'support' }]);
  });

  it('is recorded for nothing where the read fails for good, and the next place is still read', async () => {
    const service = aService({ C1: { failed: 'unreadable' } });
    await readAt(service.read(alpha, [naming('chat')], [postedIn('C1'), postedIn('C2')]));

    expect([service.asked, service.recorded.map(({ subject }) => subject)]).toEqual([
      ['chat C1 room_info', 'chat C2 room_info'],
      ['C2'],
    ]);
  });

  it.each(['unreachable', 'timed_out', 'rate_limited'] as const)(
    'ends the reads through a connection where one fails as %s, which passes by itself, and reads another connection’s places',
    async (failed) => {
      const service = aService({ C1: { failed } });
      const triggers = [postedIn('C1'), postedIn('C2'), postedIn('C3', 'team')];
      await readAt(service.read(alpha, [naming('chat'), naming('team')], triggers));

      expect([service.asked, service.recorded.map(({ subject }) => subject)]).toEqual([
        ['chat C1 room_info', 'team C3 room_info'],
        ['C3'],
      ]);
    },
  );
});

describe('the reads of names a round makes', () => {
  it('start at or past the deadline no read, the deadline checked between the reads', async () => {
    const triggers = [postedIn('C1'), postedIn('C2'), postedIn('C3', 'team')];
    const atTheDeadline = aService();
    const takingAnHour = aService({}, anHour);
    await readAt(atTheDeadline.read(alpha, [naming('chat'), naming('team')], triggers, startedAt));
    await readAt(takingAnHour.read(alpha, [naming('chat'), naming('team')], triggers, startedAt + anHour));

    expect([atTheDeadline.asked, takingAnHour.asked]).toEqual([[], ['chat C1 room_info']]);
  });

  it('never fail the round, whatever each read answers', async () => {
    const service = aService({ C1: { failed: 'connection_broken' }, C2: { failed: 'scope_lacking' } });

    const read = await readAt(Effect.exit(service.read(alpha, [naming('chat')], [postedIn('C1'), postedIn('C2')])));

    expect(Exit.isSuccess(read)).toBe(true);
  });

  it('are asked of the tool the entry declares, through the ports of the loop, and recorded on its recorder', async () => {
    const loop = loopOver([naming('chat')]);
    const service = aServiceOfTools([titled('support')], readsTheRoom);
    const ports = { ...portsOf(loop, {}), ...service.ports };
    await readAt(placeNamesReadOf(ports)(alpha, loop.connections.now(), [postedIn('C1')]));

    expect(service.sent()).toMatchObject([{ tool: { reference: { tool: 'room_info' }, input: { room: 'C1' } } }]);
    expect(loop.placesNamed()).toEqual([
      { connection: { id: 'id-of-chat', connected }, type: posted, subject: 'C1', name: 'support' },
    ]);
  });
});
