import { connectionsStreamOfOrg } from '@on.auto/connections';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { failureCodes, heldBy, inTheChannel } from '../testing/sockets/held-sockets.ts';
import { inTestTime, settled } from '../testing/sockets/in-test-time.ts';
import { SocketsOverALedger } from '../testing/sockets/sockets-over-a-ledger.ts';
import { isARegistry } from './served-sockets.ts';

describe('the sockets of a server that starts', () => {
  it('open at the first round for a registry recorded before the server started, wake what waits as each opens, and load no registry whose version did not move', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', heldBy('connection-1', 'app-1'));
        const wakeUp = server.started(context);

        const due = yield* wakeUp.wakeUp({ now: 0, sweep: false });
        yield* settled;
        const quiet = yield* wakeUp.wakeUp({ now: 30_000, sweep: false });
        yield* TestClock.adjust(60_000);
        yield* wakeUp.wakeUp({ now: 60_000, sweep: false });
        yield* server.closes('xapp-app-1');
        yield* TestClock.adjust(2000);
        yield* settled;

        expect([due.nextDueAt, quiet.nextDueAt]).toEqual([60_000, 60_000]);
        expect([server.opened, server.loads.length]).toEqual([['xapp-app-1', 'xapp-app-1'], 1]);
        expect(
          server.wakes.heard().map(({ org, connection, conversation }) => [org, connection, conversation]),
        ).toEqual([
          ['acme', 'chat-connection-1', undefined],
          ['acme', 'chat-connection-1', undefined],
        ]);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('the sockets of several orgs', () => {
  it('share one socket between connections of several orgs that hold one value, and wake each once a second for a conversation an arrival names', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', heldBy('connection-1', 'shared'));
        yield* server.recorded('globex', heldBy('connection-9', 'shared'));
        yield* server.recorded('initech', heldBy('connection-5'));
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        yield* settled;
        const atOpening = server.wakes.heard().length;

        yield* server.sends('xapp-shared', inTheChannel('C1'));
        yield* server.sends('xapp-shared', inTheChannel('C1'));
        yield* settled;
        yield* TestClock.adjust(1000);
        yield* server.sends('xapp-shared', inTheChannel('C1'));
        yield* server.sends('xapp-shared', { type: 'hello', payload: { team_id: 'T1' } });
        yield* server.sends('xapp-shared', inTheChannel('broken'));
        yield* server.sends('xapp-shared', inTheChannel('C2'));
        yield* settled;

        expect([server.opened, atOpening]).toEqual([['xapp-shared'], 2]);
        expect(
          server.wakes
            .heard()
            .slice(atOpening)
            .map(({ org, conversation }) => [org, conversation]),
        ).toEqual([
          ['acme', 'C1'],
          ['globex', 'C1'],
          ['acme', 'C1'],
          ['globex', 'C1'],
          ['acme', 'C2'],
          ['globex', 'C2'],
        ]);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('the sockets as their holders change', () => {
  it('close a socket whose last holder is removed, and keep one open whose holders change', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', [...heldBy('connection-1', 'one'), ...heldBy('connection-2', 'two')]);
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        yield* settled;

        yield* server.recorded('acme', [{ type: 'connection_removed', data: { connection: 'connection-1' } }]);
        yield* server.recorded('globex', heldBy('connection-3', 'two'));
        yield* wakeUp.wakeUp({ now: 60_000, sweep: false });
        yield* settled;

        expect([server.opened, server.closed]).toEqual([['xapp-one', 'xapp-two'], ['xapp-one']]);
        yield* wakeUp.stop();
        expect(server.closed).toEqual(['xapp-one', 'xapp-two']);
      }),
    );
  });
});

describe('the values the sockets are opened with', () => {
  it("are read from the secret store, opened with the entry's failure codes, and none where a value is gone or cannot be read, or its org is no longer listed", async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', [
          ...heldBy('connection-1', 'api', 'ledgers'),
          ...heldBy('connection-2', 'gone'),
        ]);
        yield* server.recorded('globex', heldBy('connection-3', 'unreadable'));
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        yield* settled;
        const loadsAtTheStart = server.loads.length;
        server.listingFails(true);
        yield* wakeUp.wakeUp({ now: 60_000, sweep: false });
        server.listingFails(false);
        server.forgotten('acme');
        yield* wakeUp.wakeUp({ now: 120_000, sweep: false });
        yield* settled;

        expect([server.opened, server.codes, server.closed]).toEqual([['xapp-api'], [failureCodes], ['xapp-api']]);
        expect([loadsAtTheStart, server.loads.length]).toEqual([2, 3]);
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('a socket whose value the service refuses', () => {
  it('record a value the service refuses as refused for each holder, and open no socket with it again', async () => {
    const server = new SocketsOverALedger();
    server.refusing.add('xapp-revoked');
    await inTestTime((context) =>
      Effect.gen(function* () {
        yield* server.recorded('acme', heldBy('connection-1', 'revoked'));
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        yield* settled;
        yield* wakeUp.wakeUp({ now: 60_000, sweep: false });
        yield* TestClock.adjust(120_000);
        yield* settled;
        const types = yield* server.typesIn('acme');

        expect(server.opened).toEqual(['xapp-revoked']);
        expect(types.at(-1)).toBe('connection_app_credential_refused');
        yield* wakeUp.stop();
      }),
    );
  });
});

describe('the sockets of a server that stops', () => {
  it('hear a registry changed in this process at once, and nothing more once stopped, when every socket is closed', async () => {
    const server = new SocketsOverALedger();
    await inTestTime((context) =>
      Effect.gen(function* () {
        const wakeUp = server.started(context);
        yield* wakeUp.wakeUp({ now: 0, sweep: false });
        yield* server.recorded('acme', heldBy('connection-1', 'one'));
        server.appended.raise(connectionsStreamOfOrg('acme'));
        server.appended.raise('playbook/acme/alpha/runs/r1');
        const next = yield* wakeUp.wakeUp({ now: 10, sweep: false });
        yield* settled;
        const raisedBefore = server.raised();

        yield* wakeUp.stop();
        server.appended.raise(connectionsStreamOfOrg('acme'));

        expect([next.nextDueAt, server.opened, server.closed]).toEqual([60_010, ['xapp-one'], ['xapp-one']]);
        expect([raisedBefore, server.raised()]).toEqual([1, 1]);
      }),
    );
  });
});

describe('the registry of an org', () => {
  it('is the stream of its connections alone', () => {
    expect(
      [connectionsStreamOfOrg('acme'), 'org/acme/tallies', 'playbook/acme/alpha/connections', 'org/connections'].map(
        (stream) => isARegistry(stream),
      ),
    ).toEqual([true, false, false, false]);
  });
});
