import { loadedMessage, type RoleAssignments } from '@on.auto/access-control';
import { makeAppRuntime } from '@on.auto/api';
import { playbookOwnNamesOf } from '@on.auto/definitions';
import { decidedIn, echo } from '@on.auto/definitions/testing';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import {
  Ledger,
  makeDispatcher,
  type Outcome,
  playbookCallerOf,
  type PlaybookRequest,
  undecidedMessage,
} from '@on.auto/operations';
import { capturedLogs, memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { providersShippedRoots, readProviders, type ThroughTheConnection } from '@on.auto/providers';
import {
  cardMoved,
  overTheBoardsSocket,
  providersOf,
  trackerOverASocket,
  whichSpace,
} from '@on.auto/providers/testing';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import {
  filterSandboxOf,
  freshInstances,
  handedWorkersOf,
  machineSandboxOf,
  programPool,
  sandboxModuleIn,
  sandboxShippedRoots,
} from '@on.auto/workflow-engine/dsl';
import { openWorkflowStore, StartRefused, StartRejected } from '@on.auto/workflow-host';
import { Cause, Effect, Exit, Layer, Logger, Redacted, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { applicationLayer } from '../composition/application-layer.ts';
import { keptByTheLedgerWith } from '../composition/kept-by-the-ledger.ts';
import { decisionPointServing } from '../composition/served-access-control.ts';
import { ledgerConnectionIn } from '../database/ledger-database.ts';
import { shippedRoots } from '../server-options/shipped-roots.ts';
import { socketsOfTheServer } from '../sockets/sockets-of-the-server.ts';
import { subscriptionsOfTheServer } from '../subscriptions/served-subscriptions.ts';
import { memoryRuntime } from '../testing/records/memory-runtime.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';
import { aCardMovedIn, answeredWith, noSecretsKept } from '../testing/sockets/held-sockets.ts';
import { ServiceSockets } from '../testing/sockets/service-sockets.ts';
import {
  addedAndConnected,
  connectionsRecorded,
  playbooksCreated,
  playbooksRetired,
  type ConnectionFact,
} from '../testing/subscriptions/connections-followed.ts';
import { connectionIntakeServedBy } from './connection-intake.ts';
import { type HostDispatch, hostDispatchesOf, hostOperationsOf, hostRegistrationsOf } from './host-operations.ts';
import { hostReports } from './host-reports.ts';
import { hostWorkOf } from './host-work.ts';
import { inRuntime } from './in-runtime.ts';
import { reactionsOf } from './reaction-dependencies.ts';

const memoryLedgerHostDependencies = ledgerLayer({ fileName: ':memory:' });

async function reportedLines(
  report: (reports: ReturnType<typeof hostReports>) => Promise<unknown>,
): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    lines.push(line);
  });
  const runtime = await makeAppRuntime(
    applicationLayer(memoryLedgerHostDependencies).pipe(Layer.provideMerge(Logger.layer([capture]))),
  );
  await report(hostReports(runtime));
  await runtime.dispose();
  return lines;
}

const asAlphaItself: PlaybookRequest = {
  caller: playbookCallerOf({ org: 'acme', playbook: 'alpha' }),
  org: 'acme',
  playbook: 'alpha',
  input: {},
  encoding: 'json',
};

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
  recordingReporter().layer,
);

const holdingNoRole: RoleAssignments = { heldBy: () => Effect.succeed([]) };

const refusedByTheDecisionPoint: ReadonlySet<string> = new Set(['rejected forbidden', 'rejected unavailable']);

function reasonOf(outcome: Outcome): string {
  return outcome.status === 'rejected' ? `rejected ${outcome.reason}` : outcome.status;
}

const sandboxFiles = shippedFilesOnDisk(sandboxShippedRoots());

const sandboxModule = await sandboxModuleIn(sandboxFiles);

const unknownRun = { org: 'acme', playbook: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

const lineage = { causationId: 'cancel-1', correlationId: unknownRun.id };

const start = {
  org: 'acme',
  playbook: 'alpha',
  definitionKey: 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-00000000c105/',
  workflow: 'close-the-month',
  version: 2,
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  input: [{ type: 'com.acme.ledger.closed' }],
  depth: 3,
  cause: 'record-1',
  trigger: { kind: 'event', reference: '/schedule/on' },
} as const;

async function reactingWith(answers: readonly Outcome[]) {
  const runtime = await memoryRuntime();
  onTestFinished(() => runtime.dispose());
  const requests: PlaybookRequest[] = [];
  const startVersion: HostDispatch = (request) =>
    Effect.sync(() => {
      requests.push(request);
      return answers[requests.length - 1] ?? { status: 'succeeded', output: {} };
    });
  return { reactions: reactionsOf(runtime, startVersion, playbookOwnNamesOf([echo])), requests };
}

describe('work the workflow host hands to the runtime of the server', () => {
  it('runs on the services of the runtime, and fails as it fails there', async () => {
    const runtime = await makeAppRuntime(applicationLayer(memoryLedgerHostDependencies));

    const done = await Effect.runPromise(inRuntime(runtime, Effect.succeed('done')));
    const refused = await Effect.runPromise(Effect.exit(inRuntime(runtime, Effect.fail('refused'))));
    await runtime.dispose();

    expect(done).toBe('done');
    expect(refused).toStrictEqual(Exit.fail('refused'));
  });

  it('dies once the runtime is disposed, so the host performs the call again when the server next starts', async () => {
    const runtime = await makeAppRuntime(
      Layer.empty.pipe(Layer.provideMerge(applicationLayer(memoryLedgerHostDependencies))),
    );
    await runtime.dispose();

    const exit = await Effect.runPromise(Effect.exit(inRuntime(runtime, Effect.succeed('too late'))));

    expect(String(exit)).toContain('The server stopped before the work could be done');
  });
});

describe('the reports of the workflow host', () => {
  it('log a run left started with the reason the host gave, in words', async () => {
    const lines = await reportedLines(async (reports) => {
      const run = { org: 'acme', definition: 'alpha-definition', runId: 'e-1' };
      await Effect.runPromise(reports.unsettled({ ...run, receipt: 'unknown_run' }));
      await Effect.runPromise(reports.unsettled({ ...run, receipt: 'settled_otherwise' }));
    });

    expect(lines).toEqual([
      expect.stringContaining(
        '"annotations":{"org":"acme","definition":"alpha-definition","run_id":"e-1","reason":"The ledger has no such run"}',
      ),
      expect.stringContaining('"reason":"The run was settled otherwise before"'),
    ]);
  });

  it('log trouble and a note of the host as warnings', async () => {
    const lines = await reportedLines(async (reports) => {
      await Effect.runPromise(reports.trouble('A sweep of the runs failed; the next sweep tries again', Cause.empty));
      await Effect.runPromise(
        reports.note({
          kind: 'settled_after_back_off',
          run: { org: 'acme', definition: 'alpha-definition', runId: 'e-1' },
          attempts: 21,
        }),
      );
    });

    expect(lines).toEqual([
      expect.stringContaining('"message":"A sweep of the runs failed; the next sweep tries again","level":"WARN"'),
      expect.stringContaining('"message":"A run that could not be settled was settled at attempt 21"'),
    ]);
  });
});

describe('the operations the workflow host is handed', () => {
  it('are its own, the start of a version, the run of a definition, and the next attempt of a run whose holder is gone, made or refused, each the playbook operation it dispatches', () => {
    const host = hostOperationsOf([echo]);

    expect(hostRegistrationsOf(host).map(({ scope, name }) => `${scope}/${name}`)).toEqual([
      'playbook/start_definition_version',
      'playbook/run_definition',
      'playbook/make_next_attempt',
      'playbook/refuse_next_attempt',
    ]);
  });

  it('are each declared to the decision point the server composes, which lets the playbook acting as itself make each of them', async () => {
    const host = hostOperationsOf([echo]);
    const logs = capturedLogs();

    const outcomes = await Effect.runPromise(
      decisionPointServing({ catalogs: [], host }, shippedFilesOnDisk(shippedRoots), holdingNoRole).pipe(
        Effect.flatMap((decisionPoint) =>
          Effect.forEach(
            Object.values(hostDispatchesOf(makeDispatcher([], { decidedBy: decisionPoint }), host)),
            (dispatch) => dispatch(asAlphaItself),
          ),
        ),
        Effect.provide(logs.layer),
        Effect.provide(services),
      ),
    );

    expect(outcomes.filter((outcome) => refusedByTheDecisionPoint.has(reasonOf(outcome)))).toEqual([]);
    expect(logs.logged().filter(({ message }) => message === undecidedMessage)).toEqual([]);
    expect(logs.logged().filter(({ message }) => message === loadedMessage)).toMatchObject([
      { annotations: { operations: hostRegistrationsOf(host).length } },
    ]);
  });
});

describe('the machine the workflow host decides runs with', () => {
  it("is the coordination's functions, runtime and context of each record on the pool's sandbox, so no setting of the server reaches the machine's bound on tasks without waiting", async () => {
    const runtime = await memoryRuntime();
    const pool = programPool({
      handed: await handedWorkersOf(sandboxFiles),
      instances: 'fresh',
      workers: 1,
      heapMegabytes: 64,
    });
    const { machine } = hostWorkOf(runtime, hostDispatchesOf(makeDispatcher([]), hostOperationsOf([echo])), {
      capabilities: [echo],
      names: playbookOwnNamesOf([echo]),
      lookAgain: () => Effect.void,
      evaluations: pool.evaluations,
    });
    await Promise.all([pool.close(), runtime.dispose()]);

    expect(Object.keys(machine).toSorted()).toEqual(['contextOf', 'functions', 'runtime', 'sandbox']);
    expect(machine.sandbox).toBe(pool.evaluations.machine);
    expect(Object.keys(machine.sandbox)).not.toContain('mostStepsWithoutWaiting');
  });
});

describe('the cancels the workflow host hands to the runtime of the server', () => {
  it('settle nothing for a run the ledger does not have, and answer that a run of a definition the playbook does not hold cannot be cancelled', async () => {
    const runtime = await memoryRuntime();
    const { waiting } = hostWorkOf(runtime, hostDispatchesOf(makeDispatcher([]), hostOperationsOf([echo])), {
      capabilities: [echo],
      names: playbookOwnNamesOf([echo]),
      lookAgain: () => Effect.void,
      evaluations: {
        machine: machineSandboxOf(freshInstances(sandboxModule)),
        filters: filterSandboxOf(freshInstances(sandboxModule)),
      },
    });

    const settled = await Effect.runPromise(
      Effect.as(waiting.cancelDeferred(unknownRun, { kind: 'requested', reason: 'No longer needed' }, lineage), 'left'),
    );
    const cancelled = await Effect.runPromise(
      waiting.cancel(
        { ...unknownRun, definitionType: 'echo', name: 'greet' },
        { kind: 'parent_ended', reason: 'The run that waited for it ended' },
        lineage,
      ),
    );
    await runtime.dispose();

    expect([settled, cancelled]).toEqual(['left', 'unknown_run']);
  });
});

describe('a start of a workflow its trigger matched', () => {
  it('is asked of the playbook as the playbook itself, of the definition its key names, once under the id it was given, caused by what it matched, with its trigger', async () => {
    const { reactions, requests } = await reactingWith([]);

    await Effect.runPromise(reactions.start(start));

    expect(requests).toEqual([
      {
        caller: {
          id: 'playbook:alpha',
          name: 'alpha',
          org: 'acme',
          permissions: ['playbook:read', 'playbook:write'],
          playbooks: ['alpha'],
        },
        org: 'acme',
        playbook: 'alpha',
        input: {
          type: 'workflow',
          name: 'close-the-month',
          version: 2,
          input: start.input,
          run_id: start.runId,
          definition_id: '0199a3c4-7d2e-7c1a-9b3f-00000000c105',
        },
        encoding: 'json',
        lineage: { causationId: 'record-1', correlationId: start.runId },
        depth: 3,
        trigger: { kind: 'event', reference: '/schedule/on' },
      },
    ]);
  });
});

describe('a start of a workflow the playbook does not take', () => {
  it('is tried again when the playbook cannot take it now, and not when it never will, with the kind and because of its refusal', async () => {
    const { reactions } = await reactingWith([
      { status: 'rejected', reason: 'unavailable', detail: 'The ledger is busy' },
      { status: 'failed', incident: 'i-1' },
      { status: 'rejected', reason: 'invalid_input', detail: 'The input is not what the workflow takes' },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The org has used today’s Free credits',
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
      },
    ]);

    const failures = await Effect.runPromise(Effect.forEach([1, 2, 3, 4], () => Effect.flip(reactions.start(start))));

    expect(failures).toStrictEqual([
      new StartRefused({ detail: 'The ledger is busy' }),
      new StartRefused({ detail: 'The start failed with incident i-1' }),
      new StartRejected({ detail: 'The input is not what the workflow takes' }),
      new StartRejected({
        detail: 'The org has used today’s Free credits',
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
      }),
    ]);
  });
});

describe('an event a workflow emits', () => {
  it('is recorded in the ledger of the server', async () => {
    const { reactions } = await reactingWith([]);
    const emission = {
      event: {
        specversion: '1.0',
        id: 'e1',
        source: '/ledger',
        type: 'com.acme.ledger.closed',
        time: '2026-10-01T09:00:00.000Z',
      },
      emitter: { run_id: start.runId, workflow: 'announce', version: 1 },
      depth: 1,
      by: 'playbook:alpha',
      at: '2026-10-01T09:00:00.000Z',
    };

    const outcome = await Effect.runPromise(
      reactions.emit({ org: 'acme', playbook: 'alpha' }, emission, {
        causationId: null,
        correlationId: start.runId,
      }),
    );

    expect(outcome).toBe('recorded');
  });
});

async function anIntakeOfTheServer() {
  const runtime = await makeAppRuntime(applicationLayer(memoryLedgerHostDependencies));
  onTestFinished(() => runtime.dispose());
  const store = await openWorkflowStore(await ledgerConnectionIn(runtime), []);
  const ledger = await Effect.runPromise(inRuntime(runtime, Effect.service(Ledger)));
  await connectionsRecorded(ledger, 'acme', addedAndConnected('connection-1', 'github', 'https://api.example.com/mcp'));
  const takeIn = connectionIntakeServedBy(runtime, {
    store,
    filters: filterSandboxOf(freshInstances(sandboxModule)),
    providers: Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots()))),
    now: () => Date.parse('2026-11-20T09:00:00.000Z'),
  });
  return { ledger, takeIn };
}

describe('an event a connection reports, taken in through the ports the server gives the intake', () => {
  const event = { type: 'com.example.ticket.opened', id: 'T-1', data: {} };

  it('is refused for a connection the org does not hold, and counted where one serves the playbook and no trigger names it', async () => {
    const { takeIn } = await anIntakeOfTheServer();

    const answers = await Effect.runPromise(
      Effect.all([
        takeIn({ playbook: { org: 'acme', playbook: 'alpha' }, connection: 'billing', event }),
        takeIn({ playbook: { org: 'acme', playbook: 'alpha' }, connection: 'github', event }),
      ]),
    );

    expect(answers).toEqual([{ outcome: 'refused' }, { outcome: 'not_taken', reasons: ['no_trigger'] }]);
  });

  it('is not taken for a playbook the org retired, as the registry the dispatcher reads holds it', async () => {
    const { ledger, takeIn } = await anIntakeOfTheServer();
    await playbooksCreated(ledger, 'acme', ['alpha']);
    await playbooksRetired(ledger, 'acme', ['alpha']);

    const answer = await Effect.runPromise(
      takeIn({ playbook: { org: 'acme', playbook: 'alpha' }, connection: 'github', event }),
    );

    expect(answer).toEqual({ outcome: 'not_taken', reasons: ['playbook_retired'] });
  });
});

const boards = providersOf({
  ...trackerOverASocket,
  name: 'boards',
  title: 'Boards',
  events: { types: [cardMoved], identity: whichSpace, destinations: [overTheBoardsSocket] },
});

const ada = { id: 'person:ada', name: 'Ada' };

const boardsHeld: readonly ConnectionFact[] = [
  {
    type: 'connection_added',
    data: {
      connection: 'connection-1',
      name: 'boards',
      server_type: 'mcp',
      provider: 'boards',
      placeholders: null,
      entry: { url: 'https://boards.example.com/mcp' },
      credential: { kind: 'secret', name: 'Authorization', in: 'header' },
      says: {},
      added_by: ada,
    },
  },
  {
    type: 'connection_connected',
    data: {
      connection: 'connection-1',
      secret_id: 'key-1',
      app_secret_ids: { app_level_token: 'app-1' },
      connected_by: ada,
    },
  },
];

const onACardMoved = { type: cardMoved.type, source: '/connections/boards' };

/** A workflow whose trigger names the boards connection, saved through the ledger, since no such trigger can be saved through the API yet. */
function savedOnACardMoved(ledger: Ledger['Service']): Promise<void> {
  const schedule = `schedule:\n  on: { one: { with: ${JSON.stringify(onACardMoved)} } }\n`;
  const source = workflowSource('on-a-card', `${schedule}do:\n  - noted: { set: { seen: true } }\n`);
  const filters = [{ reference: '/schedule/on/one', type: cardMoved.type, attributes: onACardMoved }];
  const created = {
    type: 'create',
    name: 'on-a-card',
    content: { source, triggers: [{ kind: 'event', reference: '/schedule/on', filters }] },
    created_by: ada,
    definition_id: crypto.randomUUID(),
    by: ada.id,
    at: '2026-11-20T09:00:00.000Z',
  } as const;
  return Effect.runPromise(decidedIn(ledger, { org: 'acme', playbook: 'alpha' }, 'workflow', created));
}

const inItsSpace: ThroughTheConnection = {
  callOnce: () => Effect.succeed(answeredWith({ self: { uid: 'B-1', space: 'S1' } })),
  requestOnce: () => Effect.die('a request was sent'),
  mostRequestBytesTo: () => 1_048_576,
};

async function publishedIn(ledger: Ledger['Service']) {
  const page = await Effect.runPromise(
    ledger.readRecorded(
      { org: 'acme', playbook: 'alpha' },
      { kind: 'everything' },
      { order: 'asc', limit: 10, types: ['event_published'] },
    ),
  );
  return page.records.map(({ type, data }) => ({ type, data }));
}

describe('an event that arrives over a socket of a server given no webhook address', () => {
  it('is taken in once through the intake the sockets are given, once the service has answered the account the connection is in, and records nothing more when the service sends it again', async () => {
    const runtime = await makeAppRuntime(
      applicationLayer(ledgerLayer({ fileName: ':memory:', ...keptByTheLedgerWith([]) })),
    );
    onTestFinished(() => runtime.dispose());
    const ledger = await Effect.runPromise(inRuntime(runtime, Effect.service(Ledger)));
    await connectionsRecorded(ledger, 'acme', boardsHeld);
    await playbooksCreated(ledger, 'acme', ['alpha']);
    await savedOnACardMoved(ledger);
    const service = new ServiceSockets();
    const { identities } = subscriptionsOfTheServer(
      runtime,
      { providers: boards, receiving: { overHttp: false, webhookUrl: undefined } },
      { tools: inItsSpace, secrets: noSecretsKept },
    );
    const appCredential = { value: Redacted.make('xapp-1'), version: 1, claimedUntil: undefined };
    const sockets = socketsOfTheServer(
      runtime,
      { providers: boards },
      {
        store: await openWorkflowStore(await ledgerConnectionIn(runtime), []),
        secrets: { read: () => Effect.succeed(appCredential) },
        opens: service.opens,
        identities,
        filters: filterSandboxOf(freshInstances(sandboxModule)),
        now: () => Date.parse('2026-11-20T09:00:00.000Z'),
      },
    )({ raised: () => {}, renewed: () => {} });
    onTestFinished(() => Effect.runPromise(sockets.stop()));

    await Effect.runPromise(sockets.wakeUp({ now: 0, sweep: false }));
    await service.whenOpened('xapp-1');
    await Effect.runPromise(sockets.wakeUp({ now: 60_000, sweep: false }));
    await Effect.runPromise(service.sends('xapp-1', aCardMovedIn('S1', 7)));
    await service.whenAcknowledged('xapp-1', 1);
    const takenOnce = await publishedIn(ledger);
    await Effect.runPromise(service.sends('xapp-1', aCardMovedIn('S1', 7)));
    await service.whenAcknowledged('xapp-1', 2);

    expect(takenOnce).toMatchObject([
      { type: 'event_published', data: { event: { source: '/connections/boards', id: 'B1/7', type: cardMoved.type } } },
    ]);
    expect(await publishedIn(ledger)).toEqual(takenOnce);
    expect(service.opened).toEqual(['xapp-1']);
  });
});
