import { nestedRunId } from '@on.auto/definitions';
import { localDeveloper } from '@on.auto/identity/testing';
import { statement } from '@on.auto/ledger';
import { answers, jsonResult, type ScriptedReply, textResult } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { readOfTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import type { TestResponse } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const expenseReview = workflowSource(
  'expense-review',
  `do:
  - judge:
      call: run_definition
      with:
        type: reasoning
        name: verdict
        input: { expense: '\${ $data.expense }' }
      output:
        as: '\${ ({ ...$input, approve: $data.approve }) }'
  - route:
      switch:
        - approved: { when: $data.approve === true, then: describe }
        - declined: { then: decline }
  - describe:
      call: run_definition
      with:
        type: reasoning
        name: summary
        input: { text: '\${ $data.expense }' }
      output:
        as: '\${ ({ approved: true, summary: $data }) }'
      then: end
  - decline:
      set: { approved: false }
`,
);

const recovering = workflowSource(
  'recovering',
  `do:
  - attempt:
      try:
        - describe:
            call: run_definition
            with: { type: reasoning, name: summary, input: { text: 7 } }
      catch:
        errors: { with: { status: 400 } }
        do:
          - recover: { set: { recovered: true } }
`,
);

const careless = workflowSource(
  'careless',
  `do:
  - describe:
      call: run_definition
      with: { type: reasoning, name: summary, input: { text: 7 } }
`,
);

const historyOf = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

const typesOfTheDeclinedReview = [
  'run_started',
  'run_succeeded',
  ...Array.from({ length: 3 }, () => 'step_finished'),
  'step_waiting',
  'workflow_input_applied',
  'workflow_input_applied',
];

let server: ReasoningServer;

async function serving(...replies: readonly ScriptedReply[]): Promise<void> {
  server = await servingWorkflows(replies);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'verdict', source: verdict, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summary, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'expense-review', source: expenseReview },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'recovering', source: recovering } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'careless', source: careless } });
}

async function ran(name: string, input: object): Promise<string> {
  const response = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input } });
  expect(response).toMatchObject({ status: 200, body: { status: 'started' } });
  return runIdIn(response.body);
}

const startedLocally = { started_by: { id: 'local', name: localDeveloper.name } };

const verdictNestedCauses = ['---', 'model: openai/gpt-5', '---', 'Should we approve {{ input.expense }}?'].join('\n');

const judging = workflowSource(
  'judging',
  `do:
  - judge:
      call: run_definition
      with: { type: reasoning, name: verdict, input: { expense: lunch } }
`,
);

const reviewing = workflowSource(
  'reviewing',
  `do:
  - review:
      call: run_definition
      with: { type: workflow, name: judging }
`,
);

async function servingAPausedVerdict(): Promise<void> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'verdict', source: verdictNestedCauses, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'judging', source: judging } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'reviewing', source: reviewing } });
  expect((await server.call('POST', `${alpha}/definitions/reasoning/verdict/pause`, { body: {} })).status).toBe(200);
}

const summaryNestedRuns = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join(
  '\n',
);

const asking = workflowSource(
  'asking',
  "do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: { text: 'long' } } }\n",
);

const nesting = workflowSource(
  'nesting',
  'do:\n  - nest: { call: run_definition, with: { type: workflow, name: asking } }\n',
);

async function servingAsking(): Promise<void> {
  server = await servingWorkflows([answers(textResult('Short.')), answers(textResult('Again.'))]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summaryNestedRuns, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'asking', source: asking } });
}

async function settledRunOf(name: string): Promise<TestResponse> {
  const started = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input: {} } });
  return settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
}

const setting = workflowSource('setting', 'do:\n  - done: { set: { done: true } }\n');

function nestingNamed(task: string): string {
  return workflowSource(
    'nesting',
    `do:\n  - ${JSON.stringify(task)}: { call: run_definition, with: { type: workflow, name: setting } }\n`,
  );
}

function taskOfReferenceBytes(bytes: number): string {
  return 'a'.repeat(bytes - '/do/0/'.length);
}

async function servingTheNested(): Promise<void> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'setting', source: setting } });
}

function saved(task: string) {
  return server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'nesting', source: nestingNamed(task) },
  });
}

const waiting = workflowSource(
  'waiting',
  'do:\n  - await: { listen: { to: { one: { with: { type: com.acme.never } } } } }\n',
);

async function waitingRun(): Promise<string> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'waiting', source: waiting } });
  const started = await server.call('POST', `${alpha}/definitions/workflow/waiting/run`, { body: { input: {} } });
  return runIdIn(started.body);
}

async function flood(runId: string, count: number, data: string): Promise<readonly number[]> {
  const statuses = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const sent = await server.call('POST', `${alpha}/runs/${runId}/events`, {
        body: { event: { id: `e${index}`, type: 'com.acme.flood', data } },
      });
      return sent.status;
    }),
  );
  return [...new Set(statuses)].toSorted((first, second) => first - second);
}

const playbookKey = 'playbook/acme/alpha/';

const definitionsOfTheOrg = 'definition/acme/';

const summaryRunLogStreams = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join(
  '\n',
);

const workflows: Readonly<Record<string, string>> = {
  setting: 'do:\n  - done: { set: { done: true } }\n',
  asking: "do:\n  - ask: { call: run_definition, with: { type: reasoning, name: summary, input: { text: 'long' } } }\n",
  nesting: 'do:\n  - nest: { call: run_definition, with: { type: workflow, name: setting } }\n',
  pausing: 'do:\n  - pause: { wait: { milliseconds: 50 } }\n',
  listening: 'do:\n  - hold: { listen: { to: { one: { with: { type: com.acme.go } } } } }\n',
  telling:
    'do:\n  - tell: { emit: { event: { with: { type: com.acme.told, source: https://acme.example/told, data: { to: ada } } } } }\n',
  reacting:
    'schedule:\n  on: { one: { with: { type: com.acme.told } } }\ndo:\n  - reacted: { set: { reacted: true } }\n',
  forking:
    'do:\n  - both:\n      fork:\n        branches:\n          - a: { set: { a: 1 } }\n          - b: { set: { b: 2 } }\n',
  guarding: `do:
  - guarded:
      try:
        - fail: { raise: { error: { type: https://example.com/errors/busy, status: 503 } } }
      catch:
        errors: { with: { status: 503 } }
        do:
          - recover: { set: { recovered: true } }
`,
};

const FirstMessages = Schema.Array(Schema.Struct({ stream: Schema.String, type: Schema.String }));

type FirstMessage = (typeof FirstMessages.Type)[number];

const decodeFirstMessages = Schema.decodeUnknownSync(FirstMessages);

let ledger: TemporaryLedger;

async function firstMessagesOfTheOrg(): Promise<readonly FirstMessage[]> {
  return decodeFirstMessages(
    await readOfTheLedgerIn(
      ledger.fileName,
      statement`SELECT stream_id AS stream, message_type AS type FROM emt_messages WHERE stream_position = 1
        AND (substr(stream_id, 1, ${playbookKey.length}) = ${playbookKey}
          OR substr(stream_id, 1, ${definitionsOfTheOrg.length}) = ${definitionsOfTheOrg})`,
    ),
  );
}

function keyOf(stream: string): string {
  return `${stream.split('/').slice(0, 3).join('/')}/`;
}

function kindOf(stream: string): string {
  return stream.split('/')[3] ?? '';
}

function streamsOfKind(messages: readonly FirstMessage[], kind: string): readonly FirstMessage[] {
  return messages.filter(({ stream }) => kindOf(stream) === kind);
}

function runsOfTheLogs(messages: readonly FirstMessage[]): readonly string[] {
  return streamsOfKind(messages, 'run-logs').map(({ stream }) => stream.replace('/run-logs/', '/runs/'));
}

function underThePlaybook(messages: readonly FirstMessage[]): readonly FirstMessage[] {
  return messages.filter(({ stream }) => keyOf(stream) === playbookKey);
}

function logsUnderNoWorkflow(messages: readonly FirstMessage[]): readonly FirstMessage[] {
  const defined = new Set(streamsOfKind(messages, 'definitions').map(({ stream }) => stream));
  return streamsOfKind(messages, 'run-logs').filter(
    ({ stream }) => !defined.has(`${keyOf(stream)}definitions/workflow`),
  );
}

function runsWithNoLog(messages: readonly FirstMessage[], runIds: readonly string[]): readonly string[] {
  const logged = new Set(
    streamsOfKind(messages, 'run-logs').map(({ stream }) => stream.slice(stream.lastIndexOf('/') + 1)),
  );
  return runIds.filter((runId) => !logged.has(runId));
}

function holdsTheLogsOf(runs: number) {
  return (messages: readonly FirstMessage[]): boolean => streamsOfKind(messages, 'run-logs').length >= runs;
}

async function definedInTurn(entries: readonly (readonly [string, string])[]): Promise<void> {
  const [entry, ...rest] = entries;
  if (entry !== undefined) {
    const [name, steps] = entry;
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name, source: workflowSource(name, steps) } });
    await definedInTurn(rest);
  }
}

async function startedInTurn(names: readonly string[], runIds: readonly string[] = []): Promise<readonly string[]> {
  const [name, ...rest] = names;
  if (name === undefined) {
    return runIds;
  }
  const response = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input: {} } });
  return startedInTurn(rest, [...runIds, runIdIn(response.body)]);
}

describe('workflows over http', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('a workflow that runs reasoning functions, over HTTP', () => {
    it('branches on the first answer, executes the second definition, and settles succeeded with what it composed', async () => {
      await serving(answers(jsonResult({ approve: true })), answers(textResult('Dinner for six, within policy.')));

      const runId = await ran('expense-review', { expense: 'a team dinner' });
      const settled = await settledRun(server, `${alpha}/runs/${runId}`);

      expect(settled).toMatchObject({
        status: 200,
        body: {
          run_id: runId,
          type: 'workflow',
          name: 'expense-review',
          status: 'succeeded',
          output: { approved: true, summary: 'Dinner for six, within policy.' },
          ...startedLocally,
        },
      });
    });

    it('leaves each nested run in the ledger under its own id, run as the caller who started the workflow', async () => {
      await serving(answers(jsonResult({ approve: true })), answers(textResult('Within policy.')));

      const runId = await ran('expense-review', { expense: 'a taxi' });
      await settledRun(server, `${alpha}/runs/${runId}`);
      const nested = await Promise.all(
        server.modelRunIds().map((id) => server.call('GET', `${alpha}/runs/${String(id)}`)),
      );

      expect(new Set([runId, ...server.modelRunIds()]).size).toBe(3);
      expect(nested.map(({ body }) => body)).toMatchObject([
        { type: 'reasoning', name: 'verdict', status: 'succeeded', output: { approve: true }, ...startedLocally },
        { type: 'reasoning', name: 'summary', status: 'succeeded', output: 'Within policy.', ...startedLocally },
      ]);
    });

    it('takes the other branch on the other answer, without executing the second definition', async () => {
      await serving(answers(jsonResult({ approve: false })));

      const runId = await ran('expense-review', { expense: 'a yacht' });

      expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
        body: { status: 'succeeded', output: { approved: false } },
      });
      expect(server.modelCalls()).toBe(1);
    });
  });

  describe('the title of a workflow, over HTTP', () => {
    it('is in its entry of the list of workflows, as its read answers it', async () => {
      server = await servingWorkflows([]);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      const title = 'Set it done';
      const source = workflowSource('setting', `  title: ${title}\ndo:\n  - done: { set: { done: true } }\n`);
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'setting', source } });

      expect(await server.call('GET', `${alpha}/definitions/workflow`)).toMatchObject({
        status: 200,
        body: { definitions: [{ name: 'setting', title }] },
      });
      expect(await server.call('GET', `${alpha}/definitions/workflow/setting`)).toMatchObject({
        status: 200,
        body: { title },
      });
    });
  });

  describe('a nested definition that rejects its input, over HTTP', () => {
    it('is an error the workflow catches with try, and recovers from', async () => {
      await serving();

      const runId = await ran('recovering', {});

      expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
        body: { status: 'succeeded', output: { recovered: true } },
      });
      expect(server.modelCalls()).toBe(0);
    });

    it('settles the workflow rejected when nothing catches it', async () => {
      await serving();

      const runId = await ran('careless', {});

      expect(await settledRun(server, `${alpha}/runs/${runId}`)).toMatchObject({
        body: { status: 'rejected', rejection: { reason: 'invalid_input' } },
      });
    });
  });

  describe('the history of a workflow run, over HTTP', () => {
    it('shows each input the run took, with the steps that moved and how they ended', async () => {
      await serving(answers(jsonResult({ approve: false })));

      const runId = await ran('expense-review', { expense: 'a yacht' });
      await settledRun(server, `${alpha}/runs/${runId}`);
      const history = await server.call('GET', `${alpha}/runs/${runId}/history`);

      const { events } = historyOf(history.body);
      const callKey: unknown = expect.stringMatching(
        new RegExp(String.raw`^\["acme/[0-9a-f-]{36}/${runId}","/do/0/judge",1\]$`, 'u'),
      );

      expect(events.map(({ type }) => type).toSorted()).toEqual(typesOfTheDeclinedReview);
      expect(events.filter(({ type }) => type === 'workflow_input_applied')).toEqual([
        {
          type: 'workflow_input_applied',
          summary: 'The workflow started, and 1 step moved.',
          data: {
            input: { kind: 'started', key: runId },
            step_count: 1,
            steps: [{ task: '/do/0/judge', run: 1, outcome: 'waiting' }],
            output_kinds: ['arm_timer', 'start_call'],
          },
        },
        {
          type: 'workflow_input_applied',
          summary: 'A function the workflow called answered, and 3 steps moved; the workflow ended.',
          data: {
            input: { kind: 'call_answered', key: callKey, status: 'succeeded' },
            step_count: 3,
            steps: [
              { task: '/do/0/judge', run: 1, outcome: 'completed' },
              { task: '/do/1/route', run: 1, outcome: 'completed' },
              { task: '/do/3/decline', run: 1, outcome: 'completed' },
            ],
            output_kinds: ['cancel_timer', 'settle'],
          },
        },
      ]);
    });
  });
});

describe('nested causes over http', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('a workflow that called a workflow whose step calls a paused function, over HTTP', () => {
    it('names its own step and the run it started as the cause, with the codes of the paused function inside', async () => {
      await servingAPausedVerdict();
      const started = await server.call('POST', `${alpha}/definitions/workflow/reviewing/run`, { body: { input: {} } });
      const reviewRun = runIdIn(started.body);
      const judgeRun = nestedRunId(reviewRun, '/do/0/review', 1);
      const paused = { status: 'rejected', reason: 'conflict', kind: 'paused' };

      expect(await settledRun(server, `${alpha}/runs/${reviewRun}`)).toMatchObject({
        body: {
          status: 'rejected',
          rejection: { reason: 'invalid_input', cause: { step: 'do/0/review', run_id: judgeRun, ...paused } },
        },
      });
      expect(await settledRun(server, `${alpha}/runs/${judgeRun}`)).toMatchObject({
        body: {
          status: 'rejected',
          rejection: {
            reason: 'invalid_input',
            cause: { step: 'do/0/judge', run_id: nestedRunId(judgeRun, '/do/0/judge', 1), ...paused },
          },
        },
      });
    });
  });
});

describe('nested runs', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('a nested run of a workflow', () => {
    it('runs under the id its workflow gives it, so a call again with that id runs the definition once', async () => {
      await servingAsking();

      const settled = await settledRunOf('asking');
      const nested = String(server.modelRunIds()[0]);
      const again = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
        body: { input: { text: 'long' }, run_id: nested },
      });

      expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
      expect(again).toMatchObject({ status: 200, body: { run_id: nested, status: 'succeeded', output: 'Short.' } });
      expect(server.modelCalls()).toBe(1);
    });

    it('may be of another workflow, whose run it waits for under the id it gives that run', async () => {
      await servingAsking();
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'nesting', source: nesting } });

      const settled = await settledRunOf('nesting');
      const nested = String(server.modelRunIds()[0]);
      const askingRuns = await server.call('GET', `${alpha}/runs?name=asking`);

      expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Short.' } });
      expect(askingRuns).toMatchObject({ body: { runs: [{ status: 'succeeded' }] } });
      expect(nested).not.toBe(runIdIn(settled.body));
    });
  });
});

describe('task references over http', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the reference of a task that starts a run, over HTTP', () => {
    it('is saved at 256 bytes, and the workflow runs to its end with the run it starts', async () => {
      await servingTheNested();

      const created = await saved(taskOfReferenceBytes(256));
      const started = await server.call('POST', `${alpha}/definitions/workflow/nesting/run`, { body: { input: {} } });
      const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);

      expect(created.status).toBe(201);
      expect(settled.body).toMatchObject({ status: 'succeeded', output: { done: true } });
    });

    it('is refused at save at its pointer one byte past that, and for a name holding U+0000', async () => {
      await servingTheNested();
      const long = taskOfReferenceBytes(257);
      const tooLong: unknown = expect.stringContaining(
        `at /do/0/${long}: The reference of this task, /do/0/${long.slice(0, 114)}…, takes 257 bytes, more than the 256 a reference may take, since a run the task starts carries it; shorten its name or the names above it`,
      );
      const unheld: unknown = expect.stringContaining(
        ': The name of the task at /do/0/notify\u0000ops holds control characters, unpaired surrogates or noncharacters, which a reference never holds',
      );

      const refused = [await saved(long), await saved('notify\u0000ops')];

      expect(refused).toMatchObject([
        { status: 422, body: { reason: 'invalid_input', errors: [{ detail: tooLong }] } },
        { status: 422, body: { reason: 'invalid_input', errors: [{ detail: unheld }] } },
      ]);
    });
  });
});

describe('workflow flood', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('a workflow flooded with events it does not consume', () => {
    it('fails once more than 64 wait, settles rejected, and answers later events not found', async () => {
      const runId = await waitingRun();

      const answered = await flood(runId, 80, 'small');
      const settled = await settledRun(server, `${alpha}/runs/${runId}`);
      const later = await server.call('POST', `${alpha}/runs/${runId}/events`, {
        body: { event: { type: 'com.acme.flood' } },
      });

      expect(answered).toContain(200);
      expect(settled).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
      expect(settled.text).toContain('The workflow was sent more events than it consumed');
      expect(later).toMatchObject({ status: 404, body: { reason: 'not_found' } });
    });

    it('fails once more than 1 MiB of events waits, however few they are', async () => {
      const runId = await waitingRun();

      await flood(runId, 8, 'x'.repeat(200_000));
      const settled = await settledRun(server, `${alpha}/runs/${runId}`);

      expect(settled).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
    });
  });
});

describe('run log streams', () => {
  afterEach(async () => {
    await server.stop();
    ledger.remove();
  });

  describe('the run log of a workflow', () => {
    it('is kept under its own kind and under the definition of its run, so no stream of the kind of a run begins with an input the engine applied, and no run or log lies under the playbook', async () => {
      ledger = temporaryLedger();
      server = await servingWorkflows([answers(textResult('Short.'))], {
        LEDGER_FILE: ledger.fileName,
      });
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/reasoning`, {
        body: { name: 'summary', source: summaryRunLogStreams, diagram: 'none' },
      });
      await definedInTurn(Object.entries(workflows));
      const startedByAPerson = await startedInTurn(Object.keys(workflows).filter((name) => name !== 'reacting'));
      const startedByACallAndByAnEvent = 2;

      const messages = await until(
        firstMessagesOfTheOrg,
        holdsTheLogsOf(startedByAPerson.length + startedByACallAndByAnEvent),
      );
      const streams = new Set(messages.map(({ stream }) => stream));

      expect(streamsOfKind(underThePlaybook(messages), 'runs')).toEqual([]);
      expect(streamsOfKind(underThePlaybook(messages), 'run-logs')).toEqual([]);
      expect(streamsOfKind(messages, 'run-logs')).toHaveLength(startedByAPerson.length + startedByACallAndByAnEvent);
      expect(runsOfTheLogs(messages).filter((run) => !streams.has(run))).toEqual([]);
      expect(logsUnderNoWorkflow(messages)).toEqual([]);
      expect(runsWithNoLog(messages, startedByAPerson)).toEqual([]);
      expect(streamsOfKind(messages, 'runs').filter(({ type }) => type === 'input_applied')).toEqual([]);
      expect(new Set(streamsOfKind(messages, 'run-logs').map(({ type }) => type))).toEqual(new Set(['input_applied']));
    });
  });
});
