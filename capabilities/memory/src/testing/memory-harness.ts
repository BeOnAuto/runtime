import { defineCreateDefinition, defineRunDefinition, type Capability, type RunMeter } from '@on.auto/definitions';
import { uncheckedPages } from '@on.auto/definitions/testing';
import {
  allPermissions,
  makeDispatcher,
  type CallerIdentity,
  type Ledger,
  type Outcome,
  type ProjectedAddress,
  type ProjectedKeyedRow,
  type Runnable,
} from '@on.auto/operations';
import { createPlaybook } from '@on.auto/playbooks';
import { Schema, type Layer } from 'effect';

import { makeMemoryFunctionAdapter } from '../capability/memory-function.ts';
import type { MemoryLedger } from '../capability/memory-ports.ts';
import type { RecordedMemoryFact } from '../facts/memory-fact-schema.ts';
import { memoryOperationsOf, type MemoryOperations } from '../operations/memory-operations.ts';
import { aLedgerOfMemories, factsIn, ranWith, rowsIn, type HarnessLedger } from './harness-services.ts';

export const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export interface MemoryHarnessOptions {
  readonly ledger?: HarnessLedger;
  readonly over?: (ledger: Ledger['Service']) => MemoryLedger;
  readonly mostKept?: number;
  readonly mostExamined?: number;
  readonly newId?: () => string;
  readonly organizationKept?: boolean;
  readonly meter?: Layer.Layer<RunMeter>;
}

interface Route<Scope extends 'org' | 'playbook'> {
  readonly registration: Runnable<Scope>;
}

export interface Asking {
  readonly caller?: CallerIdentity;
  readonly playbook?: string;
  readonly at?: string;
}

export interface MemoryHarness {
  readonly ledger: HarnessLedger;
  readonly capability: Capability;
  readonly operations: MemoryOperations;
  readonly call: (operation: Route<'playbook'>, input: unknown, asking?: Asking) => Promise<Outcome>;
  readonly callInOrg: (operation: Route<'org'>, input: unknown, asking?: Asking) => Promise<Outcome>;
  readonly define: (name: string, source: string, asking?: Asking) => Promise<Outcome>;
  readonly run: (name: string, input: unknown, asking?: Asking) => Promise<Outcome>;
  readonly playbookCreated: (playbook: string) => Promise<Outcome>;
  readonly rememberedId: (input: unknown, asking?: Asking) => Promise<string>;
  readonly rowsOf: (address: ProjectedAddress) => Promise<readonly ProjectedKeyedRow[]>;
  readonly factsOf: (stream: string) => Promise<readonly RecordedMemoryFact[]>;
}

const idIn = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ id: Schema.String }) }),
);

export function idOf(outcome: Outcome): string {
  return idIn(outcome).output.id;
}

function adaptedOver(
  ledger: HarnessLedger,
  { over, mostKept, mostExamined, newId, organizationKept }: MemoryHarnessOptions,
) {
  return {
    ledger: over === undefined ? ledger.service : over(ledger.service),
    ...(mostKept === undefined ? {} : { mostKept }),
    ...(mostExamined === undefined ? {} : { mostExamined }),
    ...(newId === undefined ? {} : { newId }),
    ...(organizationKept === undefined ? {} : { organizationKept }),
  };
}

export function memoryHarness(options: MemoryHarnessOptions = {}): MemoryHarness {
  const ledger = options.ledger ?? aLedgerOfMemories();
  const adapted = adaptedOver(ledger, options);
  const capability = makeMemoryFunctionAdapter(adapted);
  const ran = ranWith(ledger, options.meter);
  const dispatcher = makeDispatcher([]);
  const call: MemoryHarness['call'] = (operation, input, { caller = acmeAdmin, playbook = 'alpha', at } = {}) =>
    ran(
      dispatcher.dispatchToPlaybook(operation.registration, { caller, org: 'acme', playbook, input, encoding: 'json' }),
      at,
    );
  const callInOrg: MemoryHarness['callInOrg'] = (operation, input, { caller = acmeAdmin, at } = {}) =>
    ran(dispatcher.dispatchToOrg(operation.registration, { caller, org: 'acme', input, encoding: 'json' }), at);
  const operations = memoryOperationsOf(adapted);
  return {
    ledger,
    capability,
    operations,
    call,
    callInOrg,
    define: (name, source, asking) =>
      call(
        defineCreateDefinition([capability], uncheckedPages),
        { type: 'memory', name, source, diagram: 'none' },
        asking,
      ),
    run: (name, input, asking) => call(defineRunDefinition([capability]), { type: 'memory', name, input }, asking),
    playbookCreated: (playbook) => callInOrg(createPlaybook, { playbook, name: playbook }),
    rememberedId: async (input, asking) => idOf(await call(operations.remember, input, asking)),
    rowsOf: (address) => rowsIn(ledger, address),
    factsOf: (stream) => factsIn(ledger, stream),
  };
}
