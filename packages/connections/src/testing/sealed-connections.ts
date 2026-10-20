import { sealedKeeper, secretStoreOn, type SecretRows, type SecretStore } from '@on.auto/secrets';
import { recordingCustodian, type RecordingCustodian } from '@on.auto/secrets/testing';
import type { ConnectionSource, OrgConnection } from '@on.auto/tool-servers';
import { Effect, type Layer } from 'effect';

import { makeConnectionOperations } from '../operations/connection-operations.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import { added } from './additions.ts';
import { ada, fixtureServing, operationNamed, type Harness } from './harness.ts';

export interface Sealed {
  readonly rows: SecretRows;
  readonly custodian: RecordingCustodian;
  readonly store: SecretStore;
}

export function sealedIn(rows: SecretRows, custodian: RecordingCustodian = recordingCustodian()): Sealed {
  return { rows, custodian, store: secretStoreOn(rows, sealedKeeper({ current: custodian }), { current: custodian }) };
}

export async function givenThrough(h: Harness, secrets: SecretStore, input: unknown, value: string): Promise<string> {
  const giving = makeConnectionOperations({
    ...fixtureServing,
    secrets,
    policy: connectionPolicyOf({}),
    fileEntries: [],
    modelProviders: [],
    access: 'people',
    consent: h.consent,
  });
  const { id, token } = await added(h, input);
  await h.call(operationNamed(giving, 'give_credential'), ada, { id, token, value });
  return id;
}

function servedLoggingInto(connection: OrgConnection, logging: Layer.Layer<never>): OrgConnection {
  const { state } = connection;
  return state.status === 'connected'
    ? { ...connection, state: { status: 'connected', server: Effect.provide(state.server, logging) } }
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
