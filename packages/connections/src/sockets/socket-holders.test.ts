import type { Decided } from '@on.auto/operations';
import { SocketEnded, type OpensASocket, type SocketOpening } from '@on.auto/providers';
import {
  appLevelToken,
  ledgers,
  ofEachSubscription,
  overASocket,
  providersOf,
  trackerOverASocket,
  whichSpace,
} from '@on.auto/providers/testing';
import { Effect, Logger, Option, Redacted, Result, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEventSchema, type RecordedConnectionEvent } from '../registry/connection-events.ts';
import { connectionsFoldOf, connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { keptLedger } from '../testing/kept-ledger.ts';
import { socketChecksOver } from './socket-checks.ts';
import { appCredentialRefused, socketsHeldIn } from './socket-holders.ts';

const connectedAt = '2026-11-19T08:00:00.000Z';

const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth'] };

const [aKey] = trackerOverASocket.credentials;

const providers = providersOf(
  { ...trackerOverASocket, events: { destinations: [overASocket] } },
  { ...trackerOverASocket, name: 'rooms', title: 'Rooms', events: { destinations: [ofEachSubscription, overASocket] } },
  { ...trackerOverASocket, name: 'plain', title: 'Plain' },
  {
    ...Struct.omit(ledgers, ['headers', 'placeholders']),
    base_url: 'https://api.ledgers.example.com/v2',
    credentials: [aKey],
    events: { destinations: [overASocket] },
    failure_codes: failureCodes,
  },
  {
    ...trackerOverASocket,
    name: 'spaces',
    title: 'Spaces',
    events: { identity: whichSpace, destinations: [overASocket] },
  },
);

function added(connection: string, provider: string | null) {
  return {
    type: 'connection_added',
    data: {
      connection,
      name: connection.replace('connection', 'name'),
      server_type: 'mcp',
      provider,
      placeholders: null,
      entry: { url: 'https://tracker.example.com/mcp' },
      credential: { kind: 'secret', name: 'Authorization', in: 'header' },
      says: {},
      added_by: { id: 'person:ada', name: 'Ada' },
    },
  } as const;
}

function connected(connection: string, appSecretIds: Readonly<Record<string, string>>) {
  return {
    type: 'connection_connected',
    data: {
      connection,
      secret_id: `key-${connection}`,
      app_secret_ids: appSecretIds,
      connected_by: { id: 'person:ada', name: 'Ada' },
    },
  } as const;
}

const appToken = { app_level_token: 'secret-app' };

const facts = [
  added('connection-1', 'tracker'),
  added('connection-2', 'ledgers'),
  added('connection-3', 'tracker'),
  added('connection-4', 'tracker'),
  added('connection-5', null),
  added('connection-6', 'tracker'),
  added('connection-7', 'tracker'),
  added('connection-8', 'rooms'),
  added('connection-9', 'plain'),
  connected('connection-1', appToken),
  connected('connection-2', appToken),
  connected('connection-3', {}),
  connected('connection-5', appToken),
  connected('connection-6', appToken),
  connected('connection-7', appToken),
  connected('connection-8', appToken),
  connected('connection-9', appToken),
  {
    type: 'connection_app_credential_refused',
    data: { connection: 'connection-6', name: 'app_level_token', reason: 'refused' },
  },
  { type: 'connection_removed', data: { connection: 'connection-7' } },
] as const;

function recordedAt(at: string) {
  return {
    initialState: null,
    evolve: () => null,
    eventSchema: ConnectionEventSchema,
    decide: (written: readonly Decided<RecordedConnectionEvent>[]) => Result.succeed(written),
    context: () => ({ at, by: 'person:ada' }),
  };
}

async function aRegistry() {
  const registry = keptLedger().service;
  await Effect.runPromise(registry.execute(connectionsStreamOfOrg('acme'), recordedAt(connectedAt), facts));
  return registry;
}

describe('the sockets a registry holds', () => {
  it("are the connected connections that hold an app credential their entry's socket names, unrefused, with the entry's failure codes", async () => {
    const registry = await aRegistry();

    const held = await Effect.runPromise(socketsHeldIn({ registry, providers }, 'acme'));

    expect(held.version).toBe(facts.length);
    expect(held.holders).toEqual([
      expect.objectContaining({ connection: 'connection-1', name: 'name-1', provider: 'tracker', at: 0 }),
      expect.objectContaining({ connection: 'connection-2', provider: 'ledgers', failureCodes }),
      expect.objectContaining({ connection: 'connection-8', provider: 'rooms', at: 1 }),
    ]);
    expect(
      held.holders.map(({ connectedAt: at, credential, label, secretId }) => [at, credential, label, secretId]),
    ).toEqual([
      [connectedAt, 'app_level_token', appLevelToken.description, 'secret-app'],
      [connectedAt, 'app_level_token', appLevelToken.description, 'secret-app'],
      [connectedAt, 'app_level_token', appLevelToken.description, 'secret-app'],
    ]);
    expect(held.holders.map((holder) => 'failureCodes' in holder)).toEqual([false, true, false]);
  });

  it('are none in an org that holds no registry', async () => {
    const held = await Effect.runPromise(socketsHeldIn({ registry: await aRegistry(), providers }, 'globex'));

    expect(held).toEqual({ version: 0, holders: [] });
  });
});

describe('what a socket holder carries of its connection', () => {
  it('is the id of the account its connection is recorded in, where there is one, and whether the service is still to be asked who the connection is', async () => {
    const registry = keptLedger().service;
    const signedIn = {
      type: 'connection_connected',
      data: { ...connected('connection-1', appToken).data, account: { id: 'T-1', name: 'Acme' } },
    } as const;
    const identifiedInItsSpace = {
      type: 'connection_identified',
      data: { connection: 'connection-3', connected_at: connectedAt, user: { id: 'B-3' }, account: { id: 'S-9' } },
    } as const;
    await Effect.runPromise(
      registry.execute(connectionsStreamOfOrg('acme'), recordedAt(connectedAt), [
        added('connection-1', 'tracker'),
        signedIn,
        added('connection-2', 'spaces'),
        connected('connection-2', appToken),
        added('connection-3', 'spaces'),
        connected('connection-3', appToken),
        identifiedInItsSpace,
      ]),
    );

    const held = await Effect.runPromise(socketsHeldIn({ registry, providers }, 'acme'));

    expect(held.holders.map(({ connection, account, identityOwed }) => [connection, account, identityOwed])).toEqual([
      ['connection-1', 'T-1', false],
      ['connection-2', undefined, true],
      ['connection-3', 'S-9', false],
    ]);
  });
});

const anyWords: unknown = expect.any(String);

function naming(words: string): unknown {
  return expect.stringContaining(words);
}

function refusedNaming(words: string): unknown {
  return [{ name: 'app_level_token', refused: { detail: naming(words), at: anyWords } }];
}

const theRefused = {
  connection: 'connection-1',
  name: 'name-1',
  connectedAt,
  credential: 'app_level_token',
  label: appLevelToken.description,
};

describe('an app credential the service refuses', () => {
  it('is recorded refused for the connection that holds it, while it is connected at the time the socket saw', async () => {
    const registry = await aRegistry();
    const refusals = { registry, providers };

    await Effect.runPromise(appCredentialRefused(refusals, 'acme', theRefused));
    await Effect.runPromise(
      appCredentialRefused(refusals, 'acme', {
        ...theRefused,
        connection: 'connection-2',
        connectedAt: '2026-11-18T08:00:00.000Z',
      }),
    );
    const held = await Effect.runPromise(socketsHeldIn(refusals, 'acme'));

    expect(held.holders.map(({ connection }) => connection)).toEqual(['connection-2', 'connection-8']);
    expect(held.version).toBe(facts.length + 1);
  });

  it('is named in the words of the refusal by the label its entry declares, never by its name', async () => {
    const registry = await aRegistry();

    await Effect.runPromise(appCredentialRefused({ registry, providers }, 'acme', theRefused));
    const { state } = await Effect.runPromise(
      registry.load(connectionsStreamOfOrg('acme'), connectionsFoldOf(providers)),
    );
    const held = [...state.values()]
      .filter(({ connection }) => connection.id === 'connection-1')
      .flatMap(({ connection }) => connection.app_credentials);

    expect(held).toEqual(refusedNaming(appLevelToken.description));
    expect(held).not.toEqual(refusedNaming(appLevelToken.name));
  });

  it('is logged, never thrown, where the refusal cannot be recorded', async () => {
    const logged: string[] = [];
    const failing = { load: (await aRegistry()).load, execute: () => Effect.die(new Error('the ledger is down')) };

    await Effect.runPromise(
      appCredentialRefused({ registry: failing, providers }, 'acme', theRefused).pipe(
        Effect.provide(Logger.layer([Logger.map(Logger.formatJson, (line) => logged.push(line))])),
      ),
    );

    expect(logged.map((line) => line.includes('"level":"ERROR"'))).toEqual([true]);
  });
});

const [socket] = providers.providers.flatMap(({ entry }) => entry.events?.destinations ?? []);

function openingEnded(...ends: readonly (Pick<SocketEnded, 'end' | 'host'> | undefined)[]): {
  readonly opens: OpensASocket;
  readonly seen: SocketOpening[];
} {
  const seen: SocketOpening[] = [];
  const opens: OpensASocket = (opening) =>
    Effect.suspend(() => {
      const ended = ends[seen.push(opening) - 1];
      return ended === undefined
        ? Effect.succeed({ next: Effect.never, send: () => Effect.void, ping: Effect.void })
        : Effect.fail(new SocketEnded(ended));
    });
  return { opens, seen };
}

describe('an app credential checked by opening its socket once', () => {
  it('is taken where the socket opens, refused where the service refuses it, and else unreached at the host it ended at', async () => {
    const destination = Option.getOrThrow(Option.fromNullishOr(socket));
    const { opens, seen } = openingEnded(
      undefined,
      { end: 'refused' },
      { end: 'not opened', host: 'socket.chat.example.com' },
      { end: 'not opened' },
    );
    const checks = socketChecksOver(opens);
    const value = Redacted.make('xapp-1-A0001');

    const opening = { destination, value };
    const checked = await Effect.runPromise(
      Effect.forEach([opening, opening, opening, { ...opening, failureCodes }], checks.openedOnce),
    );

    expect(checked).toEqual([
      { kind: 'taken' },
      { kind: 'refused' },
      { kind: 'unreached', hosts: ['socket.chat.example.com'] },
      { kind: 'unreached', hosts: ['api.chat.example.com'] },
    ]);
    expect(seen.map(({ failureCodes: codes }) => codes)).toEqual([undefined, undefined, undefined, failureCodes]);
  });
});
