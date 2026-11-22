import { Conflict } from '@on.auto/operations';
import { Effect, type Context } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { aCardMovedIn, aNoteIn, inSpace, theCardMoved, theCardMovedAs } from '../testing/sockets/held-sockets.ts';
import { inTestTime, settled } from '../testing/sockets/in-test-time.ts';
import { SocketsOverALedger } from '../testing/sockets/sockets-over-a-ledger.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

function startedIn(
  server: Readonly<Pick<SocketsOverALedger, 'playbooksMade' | 'started'>>,
  context: Context.Context<never>,
) {
  return Effect.gen(function* () {
    yield* server.playbooksMade('acme', ['alpha']);
    const wakeUp = server.started(context);
    yield* wakeUp.wakeUp({ now: 0, sweep: false });
    yield* settled;
    return wakeUp;
  });
}

describe('an event that arrives over a socket', () => {
  it('is handed once to the intake of an active playbook, through the connection recorded in the account the message names, and the message is acknowledged', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', inSpace('connection-1', 'boards', 'S1'));
        const wakeUp = yield* startedIn(server, context);

        yield* server.sends('xapp-boards', aCardMovedIn('S1', 7));
        yield* settled;

        expect(server.handed).toEqual([{ playbook: alpha, connection: 'chat-connection-1', event: theCardMoved }]);
        expect(server.acknowledged('xapp-boards')).toEqual(['{"delivery":"d-7"}']);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('an event that arrives over a socket several connections hold', () => {
  it('reaches each connection recorded in the account the message names and no other, and none, acknowledged all the same, where no connection is in it or it names none', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', [
          ...inSpace('connection-1', 'shared', 'S1'),
          ...inSpace('connection-2', 'shared', 'S2'),
          ...inSpace('connection-3', 'shared', 'S1'),
          ...inSpace('connection-4', 'shared'),
        ]);
        const wakeUp = yield* startedIn(server, context);

        yield* server.sends('xapp-shared', aCardMovedIn('S1', 1));
        yield* server.sends('xapp-shared', aCardMovedIn('S3', 2));
        yield* server.sends('xapp-shared', aCardMovedIn(undefined, 3));
        yield* settled;

        expect(server.handedTo()).toEqual([
          ['acme', 'alpha', 'chat-connection-1'],
          ['acme', 'alpha', 'chat-connection-3'],
        ]);
        expect(server.handed.map(({ event }) => event)).toEqual([theCardMovedAs(1), theCardMovedAs(1)]);
        expect([server.opened, server.acknowledged('xapp-shared')]).toEqual([
          ['xapp-shared'],
          ['{"delivery":"d-1"}', '{"delivery":"d-2"}', '{"delivery":"d-3"}'],
        ]);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('an event that arrives over a socket the connections of several orgs share', () => {
  it('reaches only the connections recorded in its account, each in every active playbook of its own org', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', inSpace('connection-1', 'shared', 'S1'));
        yield* server.recorded('globex', inSpace('connection-9', 'shared', 'S2'));
        yield* server.recorded('initech', inSpace('connection-5', 'shared', 'S1'));
        yield* server.playbooksMade('acme', ['beta'], ['retired']);
        yield* server.playbooksMade('globex', ['gamma']);
        yield* server.playbooksMade('initech', ['delta']);
        const wakeUp = yield* startedIn(server, context);

        yield* server.sends('xapp-shared', aCardMovedIn('S1', 1));
        yield* server.sends('xapp-shared', aCardMovedIn('S2', 2));
        yield* settled;

        expect(server.handedTo()).toEqual([
          ['acme', 'beta', 'chat-connection-1'],
          ['acme', 'alpha', 'chat-connection-1'],
          ['initech', 'delta', 'chat-connection-5'],
          ['globex', 'gamma', 'chat-connection-9'],
        ]);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('a message over a socket that carries an event the intake decides on, or cannot', () => {
  it('is acknowledged once the intake takes it, does not or refuses it, and not where it cannot decide, its wake made first all the same', async () => {
    const server = new SocketsOverALedger();
    server.takesInAs(
      Effect.succeed({ outcome: 'taken' }),
      Effect.succeed({ outcome: 'not_taken', reasons: ['no_trigger'] }),
      Effect.succeed({ outcome: 'refused' }),
      Effect.fail(new Conflict({ detail: 'The stream kept changing' })),
      Effect.die(new Error('the store is gone')),
    );
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', inSpace('connection-1', 'boards', 'S1'));
        const wakeUp = yield* startedIn(server, context);
        const atOpening = server.happened.length;

        for (const serial of [1, 2, 3, 4, 5]) {
          yield* TestClock.adjust(1000);
          yield* server.sends('xapp-boards', aCardMovedIn('S1', serial));
          yield* settled;
        }

        expect(server.acknowledged('xapp-boards')).toEqual([
          '{"delivery":"d-1"}',
          '{"delivery":"d-2"}',
          '{"delivery":"d-3"}',
        ]);
        expect(server.happened.slice(atOpening)).toEqual([1, 2, 3, 4, 5].flatMap(() => ['woken', 'taken in']));
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('a message over a socket that carries a wake, an event, or both', () => {
  it('only wakes where it carries no event, as before, and wakes and then hands its event on where it carries both', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', inSpace('connection-1', 'boards', 'S1'));
        const wakeUp = yield* startedIn(server, context);
        const atOpening = server.happened.length;

        yield* TestClock.adjust(1000);
        yield* server.sends('xapp-boards', aNoteIn('S1', 1));
        yield* settled;
        yield* TestClock.adjust(1000);
        yield* server.sends('xapp-boards', aCardMovedIn('S1', 2));
        yield* settled;

        expect(server.happened.slice(atOpening)).toEqual(['woken', 'woken', 'taken in']);
        expect(server.wakes.heard().map(({ conversation }) => conversation)).toEqual([undefined, 'B1', 'B1']);
        expect(server.acknowledged('xapp-boards')).toEqual(['{"delivery":"d-1"}', '{"delivery":"d-2"}']);
        expect(server.handed.map(({ event }) => event)).toEqual([theCardMovedAs(2)]);
        yield* wakeUp.stop();
      }),
    );
  });
});
