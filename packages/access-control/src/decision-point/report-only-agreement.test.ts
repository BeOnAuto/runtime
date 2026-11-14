import {
  PlaybookIdSchema,
  allPermissions,
  defineCommand,
  defineQuery,
  makeDispatcher,
  playbookCallerOf,
  type CallerIdentity,
  type DispatcherServices,
  type Outcome,
  type PolicyDecisionPoint,
  type Runnable,
} from '@on.auto/operations';
import { capturedLogs, memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { editorRoleForEveryPerson } from '../roles/role-assignments.ts';
import { cedarOnDisk, filesOnDisk } from '../testing/access-testing.ts';
import { cedarDecisionPoint, loadedMessage } from './cedar-decision-point.ts';

const done = Schema.Struct({ done: Schema.Boolean });

const noInput = Schema.Record(Schema.String, Schema.Never);

const answered = () => Effect.succeed({ done: true });

const listThings = defineQuery('org', {
  name: 'list_things',
  title: 'List things',
  description: 'Lists the things of the org.',
  route: { method: 'GET', path: '/things' },
  inputSchema: noInput,
  outputSchema: done,
  reasons: [],
  handle: answered,
});

const countPlaybooks = defineQuery('org', {
  name: 'count_playbooks',
  title: 'Count playbooks',
  description: 'Counts the playbooks the caller may read.',
  route: { method: 'GET', path: '/playbook-count' },
  inputSchema: noInput,
  outputSchema: done,
  reasons: [],
  permittedBy: ['org:read', 'playbook:read'],
  handle: answered,
});

const searchThings = defineQuery('org', {
  name: 'search_things',
  title: 'Search things',
  description: 'Searches the things of the org, or of the playbook it names.',
  route: { method: 'GET', path: '/thing-search' },
  inputSchema: Schema.Struct({ playbook: Schema.optionalKey(PlaybookIdSchema) }),
  outputSchema: done,
  reasons: [],
  handle: answered,
});

const createThing = defineCommand('org', {
  name: 'create_thing',
  title: 'Create thing',
  description: 'Creates a thing of the org.',
  route: { method: 'POST', path: '/things' },
  inputSchema: noInput,
  outputSchema: done,
  reasons: [],
  handle: answered,
});

const labelPlaybook = defineCommand('org', {
  name: 'label_playbook',
  title: 'Label playbook',
  description: 'Labels a playbook of the org.',
  route: { method: 'PUT', path: '/playbooks/{playbook}/label' },
  inputSchema: Schema.Struct({ playbook: PlaybookIdSchema }),
  outputSchema: done,
  reasons: [],
  handle: answered,
});

const readThing = defineQuery('playbook', {
  name: 'read_thing',
  title: 'Read thing',
  description: 'Reads a thing of the playbook.',
  route: { method: 'GET', path: '/thing' },
  inputSchema: noInput,
  outputSchema: done,
  reasons: [],
  handle: answered,
});

const changeThing = defineCommand('playbook', {
  name: 'change_thing',
  title: 'Change thing',
  description: 'Changes a thing of the playbook.',
  route: { method: 'POST', path: '/thing' },
  inputSchema: noInput,
  outputSchema: done,
  reasons: [],
  handle: answered,
});

const commentOnThing = defineCommand('playbook', {
  name: 'comment_on_thing',
  title: 'Comment on thing',
  description: 'Comments on a thing of the playbook, as anyone who may read it may.',
  route: { method: 'POST', path: '/thing/comments' },
  inputSchema: noInput,
  outputSchema: done,
  reasons: [],
  permittedBy: ['playbook:read'],
  handle: answered,
});

const orgOperations: readonly Runnable<'org'>[] = [
  listThings.registration,
  countPlaybooks.registration,
  searchThings.registration,
  createThing.registration,
  labelPlaybook.registration,
];

const playbookOperations: readonly Runnable<'playbook'>[] = [
  readThing.registration,
  changeThing.registration,
  commentOnThing.registration,
];

function person(org: string, permissions: CallerIdentity['permissions'], client = false): CallerIdentity {
  return {
    id: `person:user-of-${org}`,
    name: 'A person',
    org,
    permissions,
    playbooks: '*',
    ...(client ? { client: { id: 'client-7', name: null, domain: null } } : {}),
  };
}

const callers: readonly CallerIdentity[] = [
  person('acme', allPermissions),
  person('acme', ['org:read', 'playbook:read'], true),
  person('acme', ['playbook:write'], true),
  person('acme', []),
  person('globex', allPermissions),
  { id: 'ci-key', name: 'ci-key', org: 'acme', permissions: allPermissions, playbooks: '*' },
  {
    id: 'alpha-reader',
    name: 'alpha-reader',
    org: 'acme',
    permissions: ['org:read', 'playbook:read'],
    playbooks: ['alpha'],
  },
  {
    id: 'beta-writer',
    name: 'beta-writer',
    org: 'acme',
    permissions: ['playbook:write', 'org:write'],
    playbooks: ['beta'],
  },
  playbookCallerOf({ org: 'acme', playbook: 'alpha' }),
  playbookCallerOf({ org: 'globex', playbook: 'alpha' }),
  { id: 'local', name: 'grace', org: 'acme', permissions: allPermissions, playbooks: '*' },
];

const orgInputs: readonly unknown[] = [{}, { playbook: 'alpha' }, { playbook: 'beta' }, { playbook: 'gamma' }];

type Call = (dispatcher: ReturnType<typeof makeDispatcher>) => Effect.Effect<Outcome, never, DispatcherServices>;

const playbooksAsked: readonly (readonly [string, string])[] = [
  ['acme', 'alpha'],
  ['acme', 'beta'],
  ['globex', 'alpha'],
];

function orgCallsOf(caller: CallerIdentity): readonly Call[] {
  return orgOperations.flatMap((registration) =>
    ['acme', 'globex'].flatMap((org) =>
      orgInputs.map(
        (input): Call =>
          (dispatcher) =>
            dispatcher.dispatchToOrg(registration, { caller, org, input, encoding: 'json' }),
      ),
    ),
  );
}

function playbookCallsOf(caller: CallerIdentity): readonly Call[] {
  return playbookOperations.flatMap((registration) =>
    playbooksAsked.map(
      ([org, playbook]: readonly [string, string]): Call =>
        (dispatcher) =>
          dispatcher.dispatchToPlaybook(registration, { caller, org, playbook, input: {}, encoding: 'json' }),
    ),
  );
}

const calls: readonly Call[] = callers.flatMap((caller) => orgCallsOf(caller).concat(playbookCallsOf(caller)));

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryPlaybookRegistry([
    { org: 'acme', playbook: 'alpha' },
    { org: 'acme', playbook: 'beta' },
    { org: 'globex', playbook: 'alpha' },
  ]),
  recordingReporter().layer,
);

function countingAsked(decisionPoint: PolicyDecisionPoint): {
  readonly decisionPoint: PolicyDecisionPoint;
  readonly asked: () => number;
} {
  const asked = { count: 0 };
  return {
    decisionPoint: {
      decide: (request) =>
        Effect.suspend(() => {
          asked.count += 1;
          return decisionPoint.decide(request);
        }),
    },
    asked: () => asked.count,
  };
}

function countedByReason(outcomes: readonly Outcome[]): Readonly<Record<string, number>> {
  const counted = new Map<string, number>();
  for (const outcome of outcomes) {
    const reason = outcome.status === 'rejected' ? `rejected ${outcome.reason}` : outcome.status;
    counted.set(reason, (counted.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries(counted);
}

describe('the decision point in report-only mode, with the built-in policies and every person taken as an Editor', () => {
  it('decides every call as the check that decides it today, so the dispatcher logs no difference and answers as it did', async () => {
    const counting = countingAsked(
      cedarDecisionPoint({
        module: cedarOnDisk,
        files: filesOnDisk,
        operations: [...orgOperations, ...playbookOperations],
        roles: editorRoleForEveryPerson,
      }),
    );
    const logs = capturedLogs();
    const plain = makeDispatcher([]);
    const reporting = makeDispatcher([], { reportOnly: counting.decisionPoint });

    const [today, reported] = await Effect.runPromise(
      Effect.all([Effect.forEach(calls, (call) => call(plain)), Effect.forEach(calls, (call) => call(reporting))]).pipe(
        Effect.provide(logs.layer),
        Effect.provide(services),
      ),
    );

    expect(calls.length).toBe(11 * (5 * 2 * 4 + 3 * 3));
    expect(reported).toEqual(today);
    expect(countedByReason(today)).toEqual({
      succeeded: 89,
      'rejected invalid_input': 61,
      'rejected forbidden': 389,
    });
    expect(counting.asked()).toBe(calls.length);
    expect(logs.logged().map(({ message }) => message)).toEqual([loadedMessage]);
  });
});
