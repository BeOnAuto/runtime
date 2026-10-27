import { sealedSecretStoreOn, type SecretRows, type SecretStore } from '@on.auto/secrets';
import { memoryRows, recordingCustodian, type MemoryRows, type RecordingCustodian } from '@on.auto/secrets/testing';
import type { ConnectionSource, OrgConnection } from '@on.auto/tool-servers';
import { DateTime, Effect, type Layer } from 'effect';

import { makeConnectionOperations, type ConnectionOperations } from '../operations/connection-operations.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import { added } from './additions.ts';
import { ada, fixtureServing, operationNamed, type Harness } from './harness.ts';

export interface Sealed<Rows extends SecretRows = SecretRows> {
  readonly rows: Rows;
  readonly custodian: RecordingCustodian;
  readonly store: SecretStore;
}

export function sealedIn<Rows extends SecretRows>(
  rows: Rows,
  custodian: RecordingCustodian = recordingCustodian(),
): Sealed<Rows> {
  return {
    rows,
    custodian,
    store: sealedSecretStoreOn(rows, { current: custodian }),
  };
}

export function sealedInMemory(): Sealed<MemoryRows> {
  return sealedIn(memoryRows({ now: Effect.map(DateTime.now, DateTime.toEpochMillis) }));
}

export function operationsOver(
  h: Harness,
  secrets: SecretStore,
  services: Partial<ConnectionServices> = {},
): ConnectionOperations {
  return makeConnectionOperations({
    ...fixtureServing,
    secrets,
    policy: connectionPolicyOf({}),
    fileEntries: [],
    modelProviders: [],
    variables: new Map(),
    access: 'people',
    consent: h.consent,
    ...services,
  });
}

export async function givenThrough(h: Harness, secrets: SecretStore, input: unknown, value: string): Promise<string> {
  const { id, token } = await added(h, input);
  await h.call(operationNamed(operationsOver(h, secrets), 'give_credential'), ada, { id, token, value });
  return id;
}

function servedLoggingInto(connection: OrgConnection, logging: Layer.Layer<never>): OrgConnection {
  const { state } = connection;
  return state.status === 'connected'
    ? { ...connection, state: { ...state, server: Effect.provide(state.server, logging) } }
    : connection;
}

export function sourceLoggingInto(h: Harness, secrets: SecretStore, logging: Layer.Layer<never>): ConnectionSource {
  const source = makeConnectionSource({
    ...fixtureServing,
    registry: h.ledger.service,
    secrets,
    policy: connectionPolicyOf({}),
    variables: new Map(),
    modelProviders: [],
  });
  return {
    ...source,
    connectionsOf: (org) =>
      Effect.map(source.connectionsOf(org), (connections) =>
        connections.map((connection) => servedLoggingInto(connection, logging)),
      ),
  };
}
