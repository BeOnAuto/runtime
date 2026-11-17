import { setTimeout } from 'node:timers/promises';

import { memoryRecordedContent } from '@on.auto/content/testing';
import { makeReasoningFunctionAdapter } from '@on.auto/reasoning';
import { scriptedLanguageModel } from '@on.auto/reasoning/testing';
import { noToolServers } from '@on.auto/tool-servers/testing';
import type { CheckRequest, ProgramPool, ProgramRun } from '@on.auto/workflow-engine/dsl';
import type { Consumer, FollowedRecord } from '@on.auto/workflow-host';
import { Effect, Function, Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it, onTestFinished } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import {
  type Answer,
  gatewayThatHangsFirst,
  logLinesOf,
  requestTo,
  settledOver,
  welcomingStarted,
  workflowProcess,
} from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { patientWorkerPool } from '../testing/servers/worker-pools.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { contributing, givenGoals } from '../testing/settings/goals-kept.ts';
import { until } from '../testing/waiting/until.ts';
import type { ConsumingParts } from './host-dependencies.ts';
import { longestCallOf } from './workflows.ts';

const ledger = temporaryLedger();

const approval = workflowSource(
  'approval',
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ $data[0] }' } }\n",
);

const pausing = workflowSource('pausing', 'do:\n  - pause: { wait: PT1S }\n  - done: { set: { paused: true } }\n');

const timing = workflowSource('timing', 'do:\n  - slow: { timeout: { after: PT1S }, wait: PT1H }\n');

const timersMs = 1000;

const historyOf = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

async function isWaiting(port: number, run: Answer): Promise<boolean> {
  const { body } = await requestTo(port, 'GET', `/gamma/runs/${runIdIn(run.body)}/history`);
  return historyOf(body).events.some(({ type }) => type === 'step_waiting');
}

const inputsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        type: Schema.String,
        metadata: Schema.Struct({ causation_id: Schema.NullOr(Schema.String) }),
      }),
    ),
  }),
);

const pastItsDeadline: ProgramRun = {
  ran: 'exhausted',
  limit: 'deadline',
  issue: { detail: 'The program ran past its deadline', line: null },
  work: 0,
};

const counting = workflowSource('counting', "do:\n  - count: { set: { n: '${ 1 + 1 }' } }\n");

let server: ReasoningServer;

function unitPastItsDeadline() {
  return { evaluate: Function.constant(pastItsDeadline), close: Function.constVoid };
}

function decidingPastTheDeadline(pool: ProgramPool): ProgramPool {
  const { machine } = pool.evaluations;
  return { ...pool, evaluations: { ...pool.evaluations, machine: { ...machine, unit: unitPastItsDeadline } } };
}

const poolOf: ProgramPoolOf = (settings, handedWorkflowDeadlines) =>
  decidingPastTheDeadline(patientWorkerPool(settings, handedWorkflowDeadlines));

const hundred = workflowSource(
  'hundred',
  [
    'do:',
    ...Array.from({ length: 100 }, (_, index) => `  - step${index}: { set: { n: '\${ ($data.n ?? 0) + ${index} }' } }`),
    '',
  ].join('\n'),
);

const refused = workflowSource(
  'refused',
  ['do:', "  - count: { set: { n: '${ $data.n + }' } }", "  - read: { set: { n: '${ $nope.n }' } }", ''].join('\n'),
);

function recordingChecks(): { readonly checked: readonly CheckRequest[]; readonly poolOf: ProgramPoolOf } {
  const checked: CheckRequest[] = [];
  const recording = (pool: ProgramPool): ProgramPool => ({
    ...pool,
    check: (request, signal) => {
      checked.push(request);
      return pool.check(request, signal);
    },
  });
  return {
    checked,
    poolOf: (settings, handedWorkflowChecks) => recording(patientWorkerPool(settings, handedWorkflowChecks)),
  };
}

function saving(name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source } });
}

const greeting = workflowSource('greeting', "do:\n  - greet: { set: { greeting: '${ `Hello, ${$data.name}` }' } }\n");

interface Handed {
  readonly consumer: Consumer;
  readonly records: readonly FollowedRecord[];
  readonly asked: readonly string[];
}

function handed(name: string, wants: boolean): Handed {
  const records: FollowedRecord[] = [];
  const asked: string[] = [];
  return {
    consumer: {
      name,
      types: ['run_succeeded'],
      skippedAfterSweeps: 20,
      wants: (playbookKey) =>
        Effect.sync(() => {
          asked.push(playbookKey);
          return wants;
        }),
      batchOf: (followed) =>
        Effect.succeed({
          deliveries: [
            {
              key: followed.record.id,
              workflow: name,
              deliver: Effect.sync(() => {
                records.push(followed);
              }),
              skipped: Function.constant(Effect.void),
            },
          ],
          through: followed.record.id,
          more: false,
        }),
    },
    records,
    asked,
  };
}

describe('workflow lifecycle', () => {
  afterAll(() => {
    ledger.remove();
  });

  describe('main with workflows', () => {
    it('says how it runs workflows, and exits 0 on SIGTERM', async () => {
      const child = workflowProcess(ledger.fileName);
      const port = await child.port;

      child.signal('SIGTERM');
      const exitCode = await child.exited;
      const startUpLines = logLinesOf(child)
        .filter(({ message }) => !/^(?:Model provider|No model provider)/u.test(message))
        .map(({ message, level }) => `${level} ${message}`);

      expect(exitCode).toBe(0);
      expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
      expect(startUpLines.slice(1)).toEqual([
        `INFO The ledger is kept in the file ${ledger.fileName}`,
        "INFO Content is kept in the ledger's database",
        'INFO Payload offloading is on: a payload larger than 16384 bytes is kept as content, and its record names it by its SHA-256 and its size',
        expect.stringMatching(
          /^INFO Secrets are kept in the ledger's database, sealed under the key [\da-f]{16} that the file \S+\/secrets\.key holds, and 0 sealed under the previous key were sealed again under it$/u,
        ),
        'INFO Extensions loaded, in their order of precedence: none',
        "INFO Reasoning functions run in this server: the model calls of a run add up to at most 2,000,000 input tokens, and each answer of a tool is read whole where it fits the model's context window",
        'INFO Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms',
      ]);
      expect(startUpLines[0]).toMatch(/^WARN Local mode is on: /u);
    });
  });

  describe('a server started again on the ledger of its workflows', () => {
    it('goes on with a run that waits for an event, and with ones whose timers went off while it was stopped, the fire of each caused by the record that armed it', async () => {
      const first = workflowProcess(ledger.fileName);
      const firstPort = await first.port;
      await requestTo(firstPort, 'POST', '', { playbook: 'gamma', name: 'Gamma', goals: givenGoals });
      await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', {
        name: 'approval',
        source: contributing(approval),
      });
      await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', {
        name: 'pausing',
        source: contributing(pausing),
      });
      await requestTo(firstPort, 'POST', '/gamma/definitions/workflow', {
        name: 'timing',
        source: contributing(timing),
      });
      const waiting = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/approval/run', { input: {} });
      const paused = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/pausing/run', { input: {} });
      const timed = await requestTo(firstPort, 'POST', '/gamma/definitions/workflow/timing/run', { input: {} });
      await Promise.all([paused, timed].map((run) => until(() => isWaiting(firstPort, run), Boolean)));
      const timersDueBy = Date.now() + timersMs;
      first.signal('SIGTERM');
      await first.exited;
      await setTimeout(Math.max(0, timersDueBy - Date.now()));

      const second = workflowProcess(ledger.fileName);
      const port = await second.port;
      const sent = await requestTo(port, 'POST', `/gamma/runs/${runIdIn(waiting.body)}/events`, {
        event: { type: 'com.acme.approved', data: { by: 'Ada' } },
      });
      const approved = await settledOver(port, `/gamma/runs/${runIdIn(waiting.body)}`);
      const pausedSettled = await settledOver(port, `/gamma/runs/${runIdIn(paused.body)}`);
      await settledOver(port, `/gamma/runs/${runIdIn(timed.body)}`);
      const timedHistory = await requestTo(port, 'GET', `/gamma/runs/${runIdIn(timed.body)}/history?limit=100`);
      second.signal('SIGTERM');
      const inputs = inputsOf(timedHistory.body).events.filter(({ type }) => type === 'workflow_input_applied');

      expect(sent.status).toBe(200);
      expect(approved).toMatchObject({ status: 'succeeded', output: { by: 'Ada' } });
      expect(pausedSettled).toMatchObject({ status: 'succeeded', output: { paused: true } });
      expect(inputs.map(({ metadata }) => metadata.causation_id).at(-1)).toBe(inputs[0]?.id);
      expect(await second.exited).toBe(0);
    });
  });
});

describe('workflow deadlines', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the start of a workflow whose expressions run past the deadline of an input, over HTTP', () => {
    it('is unavailable, naming the expression, the deadline of an input and the step', async () => {
      server = await servingWorkflows([], {}, poolOf);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'counting', source: counting } });

      const started = await server.call('POST', `${alpha}/definitions/workflow/counting/run`, { body: { input: {} } });

      expect(started).toMatchObject({
        status: 503,
        body: {
          reason: 'unavailable',
          detail:
            '1 + 1: The program ran past its deadline: the expressions of one input may take 2000 ms, at the step count.',
        },
      });
    });
  });
});

describe('workflow checks', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the expressions of a workflow, checked when it is saved, over HTTP', () => {
    it('checks nothing when the server starts, then a hundred expressions as one job, saves the workflow, and runs it', async () => {
      const { checked, poolOf: poolOfWorkflowChecks } = recordingChecks();
      server = await servingWorkflows([], {}, poolOfWorkflowChecks);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

      const saved = await saving('hundred', hundred);
      const started = await server.call('POST', `${alpha}/definitions/workflow/hundred/run`, { body: { input: {} } });

      expect(saved).toMatchObject({
        status: 201,
        body: { type: 'workflow', name: 'hundred', version: 1, source: hundred },
      });
      expect(checked.map(({ expressions }) => expressions.length)).toEqual([100]);
      expect(await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).toMatchObject({
        body: { status: 'succeeded', output: { n: 4950 } },
      });
    });

    it('refuses an expression that is not one, and one that names what its place lacks, at their lines', async () => {
      server = await servingWorkflows([]);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

      expect(await saving('refused', refused)).toMatchObject({
        status: 422,
        body: {
          reason: 'invalid_input',
          errors: [
            {
              pointer: '/source',
              detail:
                'Line 7, column 24: at /do/0/count/set/n: Expression expected; an expression is one TypeScript expression over $data, $context, $workflow, $runtime, $task, $input',
            },
            { pointer: '/source', detail: "Line 8, column 23: at /do/1/read/set/n: Cannot find name '$nope'." },
          ],
        },
      });
    });
  });
});

describe('workflow shutdown', () => {
  afterAll(() => {
    ledger.remove();
  });

  describe('a server that ran workflows, told to stop', () => {
    it('exits 0, holding nothing open', async () => {
      const child = workflowProcess(ledger.fileName);
      const port = await child.port;
      await requestTo(port, 'POST', '', { playbook: 'alpha', name: 'Alpha', goals: givenGoals });
      await requestTo(port, 'POST', '/alpha/definitions/workflow', {
        name: 'greeting',
        source: contributing(greeting),
      });
      const started = await requestTo(port, 'POST', '/alpha/definitions/workflow/greeting/run', {
        input: { name: 'Ada' },
      });
      const settled = await settledOver(port, `/alpha/runs/${runIdIn(started.body)}`);

      child.signal('SIGTERM');
      const exitCode = await child.exited;

      expect(settled).toMatchObject({ status: 'succeeded', output: { greeting: 'Hello, Ada' } });
      expect(exitCode).toBe(0);
      expect(child.output().stderr).not.toContain('was still running');
    });

    it.each([
      ['SIGTERM', 0, 'beta'],
      ['SIGKILL', null, 'gamma'],
    ] as const)(
      'stopped with %s while a function a workflow called still runs, exits with %s, and calls it again once started again',
      async (signal, exitedWith, playbook) => {
        const gateway = await gatewayThatHangsFirst();
        const first = workflowProcess(ledger.fileName, { MODEL_GATEWAYS: gateway.gateways });
        const runId = await welcomingStarted(await first.port, playbook);
        await gateway.firstHeard;

        first.signal(signal);
        const exitCode = await first.exited;
        const second = workflowProcess(ledger.fileName, { MODEL_GATEWAYS: gateway.gateways });
        const settled = await settledOver(await second.port, `/${playbook}/runs/${runId}`);
        second.signal('SIGTERM');

        expect(exitCode).toBe(exitedWith);
        expect(first.output().stderr).not.toContain('was still running');
        expect(settled).toMatchObject({ status: 'succeeded', output: 'Welcome, Ada.' });
        expect(gateway.requests()).toBe(2);
        expect(await second.exited).toBe(0);
      },
    );
  });
});

describe('a consumer the composition gives the workflow host', () => {
  it('is handed the finished run of a playbook it wants, and one that does not want the playbook is handed nothing', async () => {
    const wanting = handed('wanting', true);
    const unwanting = handed('unwanting', false);
    const given: ConsumingParts[] = [];
    const serverFollowerConsumers = await servingReasoning([], {}, undefined, {
      consumersOf: (parts) => {
        given.push(parts);
        return [wanting.consumer, unwanting.consumer];
      },
    });
    onTestFinished(serverFollowerConsumers.stop);
    await serverFollowerConsumers.call('POST', '/v1/orgs/acme/playbooks', {
      body: { playbook: 'alpha', name: 'Alpha' },
    });
    const source = workflowSource('quick', 'do:\n  - done: { set: { quick: true } }\n');
    await serverFollowerConsumers.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'quick', source } });

    const started = await serverFollowerConsumers.call('POST', `${alpha}/definitions/workflow/quick/run`, {
      body: { input: {} },
    });
    const runId = runIdIn(started.body);
    await settledRun(serverFollowerConsumers, `${alpha}/runs/${runId}`);
    const records = await until(
      () => wanting.records,
      (found) => found.length > 0,
    );

    expect(given).toHaveLength(1);
    expect(records.map(({ playbook, record, event }) => [playbook, record.stream, event.event.type])).toEqual([
      [{ org: 'acme', playbook: 'alpha' }, `runs/${runId}`, 'run_succeeded'],
    ]);
    expect([new Set(wanting.asked), new Set(unwanting.asked)]).toEqual([
      new Set(['playbook/acme/alpha/']),
      new Set(['playbook/acme/alpha/']),
    ]);
    expect(unwanting.records).toEqual([]);
  });
});

describe('the longest a nested run of a workflow may run', () => {
  it('is as long as its capability states, 1660 s for reasoning, and a minute more', () => {
    const reasoning = makeReasoningFunctionAdapter({
      languageModel: scriptedLanguageModel().languageModel,
      offered: { providers: [], aliases: [] },
      tools: noToolServers,
      content: memoryRecordedContent(),
    });

    expect(longestCallOf([reasoning])).toBe(1_720_000);
  });

  it('is the longest any capability states, and a minute more', () => {
    expect(longestCallOf([{ longestAnyRunMs: 5000 }, { longestAnyRunMs: 90_000 }])).toBe(150_000);
  });
});
