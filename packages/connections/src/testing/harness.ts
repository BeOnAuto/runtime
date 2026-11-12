import {
  allPermissions,
  CallFetch,
  makeDispatcher,
  type CallerIdentity,
  type Outcome,
  type Runnable,
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
import {
  documentsOffTheLoopback,
  harnessConsentOf,
  keptSecrets,
  type HarnessConsenting,
  type KeptSecrets,
} from './harness-services.ts';

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

const publicEverywhere = () => Promise.resolve(['93.184.216.34']);

export const fixtureServing = {
  providers: fixtureProviders,
  providerValues: new Map<string, Redacted.Redacted>(),
  pages: harnessPages,
  resolve: publicEverywhere,
  fetch: documentsOffTheLoopback,
};

export const loopbackPolicy = connectionPolicyOf({ allowed_hosts: ['127.0.0.1'] });

export const crmPolicy = connectionPolicyOf({ allowed_hosts: ['crm.example.com'] });

export const loopbackAndCrmPolicy = connectionPolicyOf({ allowed_hosts: ['127.0.0.1', 'crm.example.com'] });

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
  ) => Promise<Outcome>;
  readonly callListed: (
    operation: { readonly registration: Runnable<'org'> },
    caller: CallerIdentity,
    input: unknown,
  ) => Promise<Outcome>;
}

type ConnectionServices = Parameters<typeof makeConnectionOperations>[0];

export interface HarnessOptions extends Partial<Omit<ConnectionServices, 'secrets'>>, HarnessConsenting {
  readonly callFetch?: typeof globalThis.fetch;
  readonly ledger?: MemoryLedger;
}

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
    resolve: publicEverywhere,
    fetch: documentsOffTheLoopback,
    ...given,
  };
}

function dispatchedAt<R>(
  at: string,
  services: Layer.Layer<R>,
  dispatched: Effect.Effect<Outcome, never, R>,
): Promise<Outcome> {
  return Effect.runPromise(
    TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
      Effect.andThen(dispatched),
      Effect.provide(services),
    ),
  );
}

const collecting = {
  initialState: [],
  evolve: (facts: readonly RecordedConnectionEvent[], fact: RecordedConnectionEvent) => [...facts, fact],
  eventSchema: ConnectionEventSchema,
};

function callFetchOf(callFetch: typeof globalThis.fetch | undefined): Layer.Layer<never> {
  return callFetch === undefined ? Layer.empty : Layer.succeed(CallFetch, callFetch);
}

function servicesOver(
  ledger: MemoryLedger,
  log: (line: string) => void,
  callFetch: typeof globalThis.fetch | undefined,
) {
  return Layer.mergeAll(
    ledger.layer,
    Layer.provide(memoryPlaybookRegistry([]), ledger.layer),
    recordingReporter().layer,
    TestClock.layer(),
    loggingInto(log),
    callFetchOf(callFetch),
  );
}

export function harness({
  beforeKeeping,
  mostSecretCharacters,
  consenting,
  callFetch,
  ledger = memoryLedger(),
  ...given
}: HarnessOptions = {}): Harness {
  const secrets = keptSecrets({ beforeKeeping, mostSecretCharacters });
  const consent = harnessConsentOf(ledger.service, secrets, consenting);
  const logged: string[] = [];
  const services = servicesOver(
    ledger,
    (line) => {
      logged.push(line);
    },
    callFetch,
  );
  const composed = composedOf(given, { secrets, consent });
  const operations = makeConnectionOperations(composed);
  const dispatcher = makeDispatcher([]);
  return {
    ledger,
    consent,
    facts: async () => (await Effect.runPromise(ledger.service.load(connectionsStreamOfOrg('acme'), collecting))).state,
    logged: () => [...logged],
    secrets,
    operations,
    operationsWith: (changes) => makeConnectionOperations({ ...composed, ...changes }),
    call: (operation, caller, input = {}, at = firstMoment) =>
      dispatchedAt(
        at,
        services,
        dispatcher.dispatchToOrg(operation.registration, { caller, org: 'acme', input, encoding: 'json' }),
      ),
    callListed: (operation, caller, input) =>
      dispatchedAt(
        firstMoment,
        services,
        dispatcher.dispatchToOrg(operation.registration, {
          caller,
          org: 'acme',
          input,
          encoding: 'json',
          directoryListing: true,
        }),
      ),
  };
}

export function operationNamed(operations: ConnectionOperations, name: string) {
  return Option.getOrThrow(Arr.findFirst(operations, ({ registration }) => registration.name === name));
}
