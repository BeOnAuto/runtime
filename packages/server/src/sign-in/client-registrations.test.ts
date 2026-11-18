import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import type { RegisteredClient } from '@on.auto/openid-connect';
import type { StreamReader, StreamWriter } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { sealedSecretStoreOn, type SecretRows } from '@on.auto/secrets';
import { memoryRows, recordingCustodian, type RecordingCustodian } from '@on.auto/secrets/testing';
import { DateTime, Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  keptClientAt,
  latestClientAt,
  namedClientAt,
  SignInClientEventSchema,
  signInClientRegistrationsStream,
  signInClientsDecider,
  type RegistrationPlace,
  type RegistrationServices,
} from './client-registrations.ts';

const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

const place: RegistrationPlace = {
  issuer: 'https://login.example.com/tenant/v2.0',
  redirectUri: 'https://auto.example.com/auth/oidc/callback',
};

const movedTo: RegistrationPlace = { ...place, redirectUri: 'https://auto.example.org/auth/oidc/callback' };

function clientOf(clientId: string): RegisteredClient {
  return {
    clientId,
    clientSecret: Redacted.make(`a-secret-of-${clientId}`),
    tokenEndpointAuthMethod: 'client_secret_basic',
    secretExpiresAt: 0,
  };
}

function servicesOver(ledger: MemoryLedger, rows: SecretRows, custodian: RecordingCustodian): RegistrationServices {
  return { registry: ledger.service, secrets: sealedSecretStoreOn(rows, { current: custodian }) };
}

function kept(services: RegistrationServices, client: RegisteredClient, replacing?: string, at = place) {
  return Effect.runPromise(keptClientAt(services, at, client, replacing));
}

function namedAt(services: RegistrationServices, clientId: string, at = place) {
  return Effect.runPromise(Effect.map(namedClientAt(services, at, clientId), (client) => client?.clientId));
}

function latestAt(services: RegistrationServices, at = place) {
  return Effect.runPromise(latestClientAt(services, at));
}

const collecting = {
  ...signInClientsDecider,
  initialState: [],
  evolve: (facts: readonly unknown[], fact: unknown) => [...facts, fact],
};

async function factsIn(ledger: MemoryLedger): Promise<readonly unknown[]> {
  return (await Effect.runPromise(ledger.service.load(signInClientRegistrationsStream, collecting))).state;
}

const registering = {
  issuer: place.issuer,
  redirect_uri: place.redirectUri,
  client_id: 'client-2',
  secret_id: 'secret-2',
  by: 'runtime',
  at: '2026-11-18T09:00:00.000Z',
};

describe('the decider of the clients this server registered for its sign-in', () => {
  it('records a client in place of the one it read as the latest for the issuer and the redirect URI, and refuses one in place of another', () => {
    const registered = signInClientsDecider.evolve(signInClientsDecider.initialState, {
      type: 'sign_in_client_registered',
      data: { issuer: place.issuer, redirect_uri: place.redirectUri, client_id: 'client-1', secret_id: 'secret-1' },
      context: { by: 'runtime', at: registering.at },
    });

    const decided = [
      signInClientsDecider.decide({ ...registering, replacing: undefined }, signInClientsDecider.initialState),
      signInClientsDecider.decide({ ...registering, replacing: 'client-1' }, registered),
      signInClientsDecider.decide({ ...registering, replacing: undefined }, registered),
      signInClientsDecider.decide(
        { ...registering, redirect_uri: movedTo.redirectUri, replacing: undefined },
        registered,
      ),
    ];

    expect(decided).toMatchObject([
      { _tag: 'Success' },
      { _tag: 'Success' },
      { _tag: 'Failure', failure: { _tag: 'conflict', kind: 'concurrent_change' } },
      { _tag: 'Success' },
    ]);
    expect(signInClientsDecider.context({ ...registering, replacing: undefined }, registered)).toEqual({
      by: 'runtime',
      at: registering.at,
    });
  });
});

describe('the clients this server registered for its sign-in', () => {
  it('are kept as a fact that names the secret it sealed, never the secret, and found again after a restart, the latest last', async () => {
    const [ledger, rows, custodian] = [memoryLedger(), memoryRows({ now }), recordingCustodian()];
    await kept(servicesOver(ledger, rows, custodian), clientOf('client-1'));
    await kept(servicesOver(ledger, rows, custodian), clientOf('client-2'), 'client-1');

    const restarted = servicesOver(ledger, rows, custodian);

    expect([await latestAt(restarted), await namedAt(restarted, 'client-1')]).toEqual(['client-2', 'client-1']);
    expect(await factsIn(ledger)).toMatchObject([
      {
        type: 'sign_in_client_registered',
        data: { client_id: 'client-1', secret_id: rows.kept()[0]?.id },
        context: { by: 'runtime' },
      },
      { type: 'sign_in_client_registered', data: { client_id: 'client-2', secret_id: rows.kept()[1]?.id } },
    ]);
    expect(JSON.stringify(await factsIn(ledger))).not.toContain('a-secret-of');
  });

  it('are kept apart for each redirect URI, so a server at a new address finds none there', async () => {
    const services = servicesOver(memoryLedger(), memoryRows({ now }), recordingCustodian());
    await kept(services, clientOf('client-1'));

    expect([await latestAt(services, movedTo), await namedAt(services, 'client-1', movedTo)]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('are none whose secret the store no longer keeps or sealed under a key it no longer has', async () => {
    const [ledger, rows] = [memoryLedger(), memoryRows({ now })];
    const sealing = recordingCustodian();
    await kept(servicesOver(ledger, rows, sealing), clientOf('client-1'));
    await kept(servicesOver(ledger, rows, sealing), clientOf('client-2'), 'client-1');
    await Effect.runPromise(servicesOver(ledger, rows, sealing).secrets.forget(String(rows.kept()[1]?.id)));

    expect([
      await namedAt(servicesOver(ledger, rows, sealing), 'client-2'),
      await namedAt(servicesOver(ledger, rows, recordingCustodian()), 'client-1'),
    ]).toEqual([undefined, undefined]);
  });
});

function recordedFirstBy(ledger: MemoryLedger, otherStart: Effect.Effect<unknown>): StreamReader & StreamWriter {
  const raced = { yet: false };
  const racedOnce = Effect.suspend(() => {
    const first = !raced.yet;
    raced.yet = true;
    return first ? otherStart : Effect.void;
  });
  return {
    ...ledger.service,
    execute: (stream, decider, command, lineage) =>
      Effect.andThen(racedOnce, ledger.service.execute(stream, decider, command, lineage)),
  };
}

describe('two servers of one database that register at the same moment', () => {
  it('keep one registration: the other server uses it and forgets the secret it sealed for its own', async () => {
    const [ledger, rows, custodian] = [memoryLedger(), memoryRows({ now }), recordingCustodian()];
    const other = servicesOver(ledger, rows, custodian);
    const theirs = Effect.orDie(keptClientAt(other, place, clientOf('client-theirs')));
    const racing = { ...other, registry: recordedFirstBy(ledger, theirs) };

    const ours = await kept(racing, clientOf('client-ours'));

    expect([ours.inUse.clientId, ours.recordedFirstElsewhere]).toEqual(['client-theirs', true]);
    expect([(await factsIn(ledger)).length, rows.kept().length]).toEqual([1, 1]);
  });

  it('cannot go on where the registration the other server recorded is no longer kept', async () => {
    const [ledger, rows, custodian] = [memoryLedger(), memoryRows({ now }), recordingCustodian()];
    const other = servicesOver(ledger, rows, custodian);
    const theirs = Effect.orDie(
      Effect.gen(function* () {
        yield* keptClientAt(other, place, clientOf('client-theirs'));
        const { state } = yield* ledger.service.load(signInClientRegistrationsStream, signInClientsDecider);
        yield* other.secrets.forget(String(state.at(-1)?.secret_id));
      }),
    );

    const failed = await Effect.runPromise(
      Effect.flip(
        keptClientAt({ ...other, registry: recordedFirstBy(ledger, theirs) }, place, clientOf('client-ours')),
      ),
    );

    expect(failed).toMatchObject({ _tag: 'SignInClientUnavailable' });
  });
});

describe('the clients this server registered, in a secret store that cannot answer now', () => {
  it('are not read and not kept, and nothing is recorded of one it cannot keep', async () => {
    const [ledger, rows, custodian] = [memoryLedger(), memoryRows({ now }), recordingCustodian()];
    const services = servicesOver(ledger, rows, custodian);
    await kept(services, clientOf('client-1'));
    custodian.refuse();

    const failures = await Effect.runPromise(
      Effect.all([
        Effect.flip(namedClientAt(services, place, 'client-1')),
        Effect.flip(keptClientAt(services, place, clientOf('client-2'), 'client-1')),
      ]),
    );

    expect(failures).toMatchObject([{ _tag: 'SignInClientUnavailable' }, { _tag: 'SignInClientUnavailable' }]);
    expect(await factsIn(ledger)).toHaveLength(1);
  });
});

describe('the facts of the clients this server registered for its sign-in', () => {
  recordedFactsBehaviour({
    schema: SignInClientEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.66.0': [
        {
          type: 'sign_in_client_registered',
          data: {
            issuer: 'https://login.example.com/tenant/v2.0',
            redirect_uri: 'https://auto.example.com/auth/oidc/callback',
            client_id: 'a-client-of-the-test',
            secret_id: '019a5d2e-6b1c-7e4a-9f3b-2c1d0e9f8a7b',
          },
          context: { at: '2026-11-18T09:00:00.000Z', by: 'runtime' },
        },
      ],
    },
  });
});
