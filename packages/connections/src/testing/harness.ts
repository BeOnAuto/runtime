import {
  allPermissions,
  makeDispatcher,
  type CallerIdentity,
  type Outcome,
  type Runnable,
  type Succeeded,
} from '@on.auto/operations';
import {
  memoryLedger,
  memoryPlaybookRegistry,
  recordingReporter,
  type MemoryLedger,
} from '@on.auto/operations/testing';
import { fixtureProviders } from '@on.auto/providers/testing';
import { Array as Arr, DateTime, Effect, Layer, Logger, Option, Redacted } from 'effect';
import { TestClock } from 'effect/testing';

import { makeConnectionOperations, type ConnectionOperations } from '../operations/connection-operations.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { ConnectionEventSchema, type RecordedConnectionEvent } from '../registry/connection-events.ts';
import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { harnessConsentOf, keptSecrets, type KeptSecrets, type HarnessConsenting } from './harness-services.ts';

const firstMoment = '2026-10-15T14:00:00.000Z';

const studio = { origin: 'https://studio.on.auto', served: false };

const runtimeOrigin = 'http://localhost:5555';

export const ada: CallerIdentity = {
  id: 'person:ada',
  name: 'Ada Lovelace',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const grace: CallerIdentity = { ...ada, id: 'person:grace', name: 'Grace Hopper' };

export const recordedAs = { ada: { id: ada.id, name: ada.name }, grace: { id: grace.id, name: grace.name } };

export const acmeReader: CallerIdentity = { ...ada, id: 'acme-reader', name: 'acme-reader', permissions: ['org:read'] };

export const acmeViewer: CallerIdentity = {
  ...ada,
  id: 'acme-viewer',
  name: 'acme-viewer',
  permissions: ['playbook:read'],
};

export const acmeWriter: CallerIdentity = {
  ...ada,
  id: 'acme-writer',
  name: 'acme-writer',
  permissions: ['org:write'],
};

export const acmePlaybookWriter: CallerIdentity = {
  ...ada,
  id: 'acme-playbook-writer',
  name: 'acme-playbook-writer',
  permissions: ['playbook:write'],
};

export const harnessPages = { studio, runtime: () => runtimeOrigin };

export const fixtureServing = {
  providers: fixtureProviders,
  providerValues: new Map<string, Redacted.Redacted>(),
  pages: harnessPages,
};

export const developerToken = 'metrics-developer-token-0123';

export const developerTokenSet: ReadonlyMap<string, Redacted.Redacted> = new Map([
  ['METRICS_DEVELOPER_TOKEN', Redacted.make(developerToken)],
]);

export interface Harness {
  readonly ledger: MemoryLedger;
  readonly consent: ReturnType<typeof harnessConsentOf>;
  readonly facts: () => Promise<readonly RecordedConnectionEvent[]>;
  readonly logged: () => readonly string[];
  readonly secrets: KeptSecrets;
  readonly operations: ConnectionOperations;
  readonly operationsWith: (changes: Partial<ConnectionServices>) => ConnectionOperations;
  readonly call: (
    operation: { readonly registration: Runnable<'org'> },
    caller: CallerIdentity,
    input?: unknown,
    at?: string,
  ) => Promise<Outcome<Succeeded>>;
}

type ConnectionServices = Parameters<typeof makeConnectionOperations>[0];

export interface HarnessOptions extends Partial<Omit<ConnectionServices, 'secrets'>>, HarnessConsenting {}

function loggingInto(log: (line: string) => void) {
  return Logger.layer([Logger.map(Logger.formatJson, log)]);
}

function composedOf(
  given: Partial<ConnectionServices>,
  { secrets, consent }: Pick<ConnectionServices, 'secrets' | 'consent'>,
): ConnectionServices {
  return {
    secrets,
    policy: connectionPolicyOf({}),
    fileEntries: ['wiki'],
    modelProviders: ['openai'],
    providers: fixtureProviders,
    providerValues: new Map(),
    variables: new Map(),
    pages: harnessPages,
    access: 'people',
    consent,
    ...given,
  };
}

export function harness({ beforeKeeping, mostSecretCharacters, consenting, ...given }: HarnessOptions = {}): Harness {
  const ledger = memoryLedger();
  const secrets = keptSecrets({ beforeKeeping, mostSecretCharacters });
  const consent = harnessConsentOf(ledger.service, secrets, consenting);
  const logged: string[] = [];
  const services = Layer.mergeAll(
    ledger.layer,
    Layer.provide(memoryPlaybookRegistry([]), ledger.layer),
    recordingReporter().layer,
    TestClock.layer(),
    loggingInto((line) => {
      logged.push(line);
    }),
  );
  const composed = composedOf(given, { secrets, consent });
  const operations = makeConnectionOperations(composed);
  const dispatcher = makeDispatcher([]);
  const collecting = {
    initialState: [],
    evolve: (facts: readonly RecordedConnectionEvent[], fact: RecordedConnectionEvent) => [...facts, fact],
    eventSchema: ConnectionEventSchema,
  };
  return {
    ledger,
    consent,
    facts: async () => (await Effect.runPromise(ledger.service.load(connectionsStreamOfOrg('acme'), collecting))).state,
    logged: () => [...logged],
    secrets,
    operations,
    operationsWith: (changes) => makeConnectionOperations({ ...composed, ...changes }),
    call: (operation, caller, input = {}, at = firstMoment) =>
      Effect.runPromise(
        TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
          Effect.andThen(
            dispatcher.dispatchToOrg(operation.registration, { caller, org: 'acme', input, encoding: 'json' }),
          ),
          Effect.provide(services),
        ),
      ),
  };
}

export function operationNamed(operations: ConnectionOperations, name: string) {
  return Option.getOrThrow(Arr.findFirst(operations, ({ registration }) => registration.name === name));
}
