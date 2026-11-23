import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  aCardMovedIn,
  answeredWith,
  connectedAgain,
  inCards,
  inSpace,
  theCardMoved,
  unreachable,
} from '../testing/sockets/held-sockets.ts';
import { inTestTime, settled } from '../testing/sockets/in-test-time.ts';
import { SocketsOverALedger } from '../testing/sockets/sockets-over-a-ledger.ts';

const inS1 = answeredWith({ self: { uid: 'B-1', space: 'S1' } });

const connectedAgainAt = '2026-11-19T09:00:00.000Z';

function identifiedAt(connectedAt: string) {
  return { connection: 'connection-1', connected_at: connectedAt, user: { id: 'B-1' }, account: { id: 'S1' } };
}

describe('the account a connection of a socket is in, where its entry says which tool to ask', () => {
  it('is asked at a round as the connection and recorded, asked no more for that connecting, asked again for a new one, and asked where no playbook is active too', async () => {
    const server = new SocketsOverALedger();
    server.answers.set('connection-1', inS1);
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', inSpace('connection-1', 'boards'));
        yield* server.recorded('globex', inSpace('connection-2', 'boards'));
        yield* server.playbooksMade('acme', ['alpha', 'beta']);
        yield* server.playbooksMade('globex', [], ['gamma']);
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        yield* TestClock.adjust(60_000);
        yield* wakeUp.wakeUp({ now: 60_000, sweep: false });
        const askedAtFirst = [...server.asked];
        yield* server.recorded('acme', [connectedAgain('connection-1', 'boards')], connectedAgainAt);
        yield* TestClock.adjust(60_000);
        yield* wakeUp.wakeUp({ now: 120_000, sweep: false });

        expect([askedAtFirst, server.asked]).toEqual([
          ['connection-1', 'connection-2'],
          ['connection-1', 'connection-2', 'connection-1'],
        ]);
        expect(yield* server.identifiedIn('acme')).toEqual([
          identifiedAt('2026-11-19T08:00:00.000Z'),
          identifiedAt(connectedAgainAt),
        ]);
        expect(yield* server.identifiedIn('globex')).toEqual([
          { connection: 'connection-2', connected_at: '2026-11-19T08:00:00.000Z', user: { id: 'B-connection-2' } },
        ]);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('a read of the account a connection of a socket is in that fails', () => {
  it('is made again at the next round where the failure passes, and not where it lasts until the connection is connected again, logged once a connecting with its org and connection', async () => {
    const server = new SocketsOverALedger();
    const logged: string[] = [];
    server.answers.set('connection-1', unreachable);
    server.answers.set('connection-2', answeredWith({ self: { space: 'S1' } }));
    await inTestTime(
      (context) =>
        Effect.gen(function* () {
          yield* server.recorded('acme', [...inSpace('connection-1', 'one'), ...inSpace('connection-2', 'two')]);
          const wakeUp = server.started(context);
          yield* wakeUp.wakeUp({ now: 0, sweep: false });
          yield* TestClock.adjust(60_000);
          yield* wakeUp.wakeUp({ now: 60_000, sweep: false });
          const askedBefore = [...server.asked];
          yield* server.recorded('acme', [connectedAgain('connection-2', 'two')], connectedAgainAt);
          yield* TestClock.adjust(60_000);
          yield* wakeUp.wakeUp({ now: 120_000, sweep: false });

          expect(askedBefore).toEqual(['connection-1', 'connection-2', 'connection-1']);
          expect(server.asked.slice(askedBefore.length)).toEqual(['connection-1', 'connection-2']);
          yield* wakeUp.stop();
        }),
      (line) => {
        logged.push(line);
      },
    );
    const heldBack = logged.filter((line) => line.includes('"connection":"connection-2"'));

    const warned = heldBack.filter((line) => line.includes('"level":"WARN"'));

    expect(warned.filter((line) => line.includes('"org":"acme"'))).toHaveLength(2);
    expect(heldBack.filter((line) => line.includes('S1'))).toEqual([]);
  });
});

describe('the account a connection of a socket is in, recorded after its socket opened', () => {
  it('reaches the socket that runs, which then takes an event in that account in, and is not opened again', async () => {
    const server = new SocketsOverALedger();
    server.answers.set('connection-1', inS1);
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', inSpace('connection-1', 'boards'));
        yield* server.playbooksMade('acme', ['alpha']);
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        yield* settled;
        yield* server.sends('xapp-boards', aCardMovedIn('S1', 6));
        yield* settled;
        const handedBefore = server.handed.length;
        yield* TestClock.adjust(60_000);
        yield* wakeUp.wakeUp({ now: 60_000, sweep: false });
        yield* server.sends('xapp-boards', aCardMovedIn('S1', 7));
        yield* settled;

        expect(handedBefore).toBe(0);
        expect(server.handed).toEqual([
          { playbook: { org: 'acme', playbook: 'alpha' }, connection: 'chat-connection-1', event: theCardMoved },
        ]);
        expect([server.opened, server.closed]).toEqual([['xapp-boards'], []]);
        expect(server.acknowledged('xapp-boards')).toEqual(['{"delivery":"d-6"}', '{"delivery":"d-7"}']);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('the reads of a round of the sockets', () => {
  it('stop at one round’s length from its start, in every org, and the next round reads on from what is still owed', async () => {
    const server = new SocketsOverALedger();
    server.lateBy.set('connection-1', 60_000);
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', [...inSpace('connection-1', 'one'), ...inSpace('connection-2', 'two')]);
        yield* server.recorded('globex', inSpace('connection-9', 'nine'));
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        const askedInTheFirst = [...server.asked];
        yield* wakeUp.wakeUp({ now: 60_000, sweep: false });

        expect([askedInTheFirst, server.asked]).toEqual([
          ['connection-1'],
          ['connection-1', 'connection-2', 'connection-9'],
        ]);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('the connections a round of the sockets reads in an org, whose entry asks who a connection is by an HTTP request', () => {
  it('are each read through the first active playbook it serves, once a round, after those asked as the connection, and never where no playbook is active', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', [
          ...inCards('connection-1', 'one'),
          ...inCards('connection-2', 'two'),
          { type: 'connection_playbooks_set', data: { connection: 'connection-2', playbooks: ['beta'] } },
          ...inSpace('connection-3', 'three'),
        ]);
        yield* server.recorded('globex', inCards('connection-9', 'nine'));
        yield* server.playbooksMade('acme', ['alpha', 'beta', 'gamma']);
        yield* server.playbooksMade('globex', [], ['delta']);
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });

        expect(server.asked).toEqual(['connection-3', 'chat-connection-1', 'chat-connection-2']);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('the reads of a round of the sockets through a playbook', () => {
  it('stop at one round’s length from its start too, and the next round reads on from what is still owed', async () => {
    const server = new SocketsOverALedger();
    server.lateBy.set('chat-connection-1', 60_000);
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', [...inCards('connection-1', 'one'), ...inCards('connection-2', 'two')]);
        yield* server.recorded('globex', inCards('connection-9', 'nine'));
        yield* server.playbooksMade('acme', ['alpha']);
        yield* server.playbooksMade('globex', ['gamma']);
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        const askedInTheFirst = [...server.asked];
        yield* wakeUp.wakeUp({ now: 60_000, sweep: false });

        expect([askedInTheFirst, server.asked]).toEqual([
          ['chat-connection-1'],
          ['chat-connection-1', 'chat-connection-2', 'chat-connection-9'],
        ]);
        yield* wakeUp.stop();
      }),
    );
  });
});
