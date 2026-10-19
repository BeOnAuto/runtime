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
import { Array as Arr, DateTime, Effect, Layer, Option, Redacted } from 'effect';
import { TestClock } from 'effect/testing';

import { makeConnectionOperations, type ConnectionOperations } from '../operations/connection-operations.ts';
import type { ConnectionServices, SecretKeeping } from '../operations/connection-services.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { ConnectionEventSchema, type RecordedConnectionEvent } from '../registry/connection-events.ts';
import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';

const firstMoment = '2026-10-15T14:00:00.000Z';

const studio = 'https://studio.on.auto';

const runtimeOrigin = 'http://localhost:5555';

export const ada: CallerIdentity = { id: 'person:ada', org: 'acme', permissions: allPermissions, playbooks: '*' };

export const grace: CallerIdentity = { ...ada, id: 'person:grace' };

export const acmeReader: CallerIdentity = { ...ada, id: 'acme-reader', permissions: ['org:read'] };

export const acmeViewer: CallerIdentity = { ...ada, id: 'acme-viewer', permissions: ['playbook:read'] };

interface KeptSecrets extends SecretKeeping {
  readonly values: () => ReadonlyMap<string, string>;
  readonly endings: () => ReadonlyMap<string, string>;
}

function keptSecrets(beforeKeeping: () => Promise<unknown> = () => Promise.resolve()): KeptSecrets {
  const values = new Map<string, string>();
  const endings = new Map<string, string>();
  return {
    keep: (value, endsWith) =>
      Effect.andThen(Effect.promise(beforeKeeping), () => {
        const text = Redacted.value(value);
        if (text.length > 64) {
          return Effect.fail({ detail: 'A secret to keep holds more than 64 characters' });
        }
        const id = `secret-${values.size + 1}`;
        values.set(id, text);
        if (endsWith !== undefined) {
          endings.set(id, endsWith);
        }
        return Effect.succeed(id);
      }),
    read: (id) =>
      Effect.sync(() =>
        Option.getOrUndefined(
          Option.map(Option.fromNullishOr(values.get(id)), (text) => ({ value: Redacted.make(text) })),
        ),
      ),
    endingsOf: (ids) =>
      Effect.sync(() => new Map([...endings].filter(([id]: readonly [string, string]) => ids.includes(id)))),
    forget: (id) =>
      Effect.sync(() => {
        values.delete(id);
        endings.delete(id);
      }),
    values: () => new Map(values),
    endings: () => new Map(endings),
  };
}

export const fixtureServing = { providers: fixtureProviders, providerValues: new Map<string, Redacted.Redacted>() };

export const developerToken = 'metrics-developer-token-0123';

export const developerTokenSet: ReadonlyMap<string, Redacted.Redacted> = new Map([
  ['METRICS_DEVELOPER_TOKEN', Redacted.make(developerToken)],
]);

export interface Harness {
  readonly ledger: MemoryLedger;
  readonly facts: () => Promise<readonly RecordedConnectionEvent[]>;
  readonly secrets: KeptSecrets;
  readonly operations: ConnectionOperations;
  readonly call: (
    operation: { readonly registration: Runnable<'org'> },
    caller: CallerIdentity,
    input?: unknown,
    at?: string,
  ) => Promise<Outcome<Succeeded>>;
}

export interface HarnessOptions extends Partial<Omit<ConnectionServices, 'secrets'>> {
  readonly beforeKeeping?: () => Promise<unknown>;
}

export function harness({ beforeKeeping, ...given }: HarnessOptions = {}): Harness {
  const ledger = memoryLedger();
  const secrets = keptSecrets(beforeKeeping);
  const services = Layer.mergeAll(
    ledger.layer,
    Layer.provide(memoryPlaybookRegistry([]), ledger.layer),
    recordingReporter().layer,
    TestClock.layer(),
  );
  const operations = makeConnectionOperations({
    secrets,
    policy: connectionPolicyOf({}),
    fileEntries: ['wiki'],
    modelProviders: ['openai'],
    providers: fixtureProviders,
    providerValues: new Map(),
    pages: { studio, runtime: () => runtimeOrigin },
    access: 'people',
    ...given,
  });
  const dispatcher = makeDispatcher([]);
  const collecting = {
    initialState: [],
    evolve: (facts: readonly RecordedConnectionEvent[], fact: RecordedConnectionEvent) => [...facts, fact],
    eventSchema: ConnectionEventSchema,
  };
  return {
    ledger,
    facts: async () => (await Effect.runPromise(ledger.service.load(connectionsStreamOfOrg('acme'), collecting))).state,
    secrets,
    operations,
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
