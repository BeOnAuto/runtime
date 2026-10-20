import { providerListOf } from '@on.auto/providers/testing';
import type { SecretStore } from '@on.auto/secrets';
import type { MemoryRows } from '@on.auto/secrets/testing';
import type { ConsentClientOptions } from '@on.auto/tool-servers';
import { registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';

import type { ConnectionOperations } from '../operations/connection-operations.ts';
import { consentHarnessAt, filesAt, filesWay } from './consents.ts';
import { harnessConsentOf } from './harness-services.ts';
import { ada, operationNamed, type Harness } from './harness.ts';
import { operationsOver, sealedInMemory, type Sealed } from './sealed-connections.ts';

export interface SealedHarness extends Sealed<MemoryRows> {
  readonly h: Harness;
  readonly operations: ConnectionOperations;
}

export interface SealedConsenting {
  readonly way?: Readonly<Record<string, unknown>>;
  readonly consenting?: Partial<ConsentClientOptions>;
  readonly registrations?: SecretStore;
}

export function sealedConsentAt(
  fake: FakeMcpServer,
  { way = filesWay, consenting = {}, registrations }: SealedConsenting = {},
): SealedHarness {
  const clients = { registeredClients: [registeredAt(fake.origin)], ...consenting };
  const h = consentHarnessAt(fake, { way, consenting: clients });
  const sealed = sealedInMemory();
  const consent = harnessConsentOf(h.ledger.service, registrations ?? sealed.store, clients);
  const operations = operationsOver(h, sealed.store, { providers: providerListOf(filesAt(fake, way)), consent });
  return { ...sealed, h, operations };
}

export function calledThrough({ h, operations }: SealedHarness, name: string, input: unknown) {
  return h.call(operationNamed(operations, name), ada, input);
}
