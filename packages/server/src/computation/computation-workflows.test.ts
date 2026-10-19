import { withMcpSession } from '@on.auto/api/testing';
import { campaignPace, campaignRows } from '@on.auto/computation/testing';
import { jsonResult, textResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { patientWorkerPool, scriptedWorkerPool } from '../testing/servers/worker-pools.ts';
import {
  runIdIn,
  servingWorkflows,
  settledRun,
  settledOverMcp,
  workflowSource,
} from '../testing/servers/workflow-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const readRows = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'tools: [graph/echo]',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {rows: {type: array}}, required: [rows]}',
  '---',
  'Read the rows of the campaigns {{ input.campaigns }} from the graph.',
].join('\n');

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {total_spend_cents: {type: integer}}, required: [total_spend_cents]}',
  '---',
  'Write one sentence about a total spend of {{ input.total_spend_cents }} cents.',
].join('\n');

const raising = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: Input): Output {',
  "  throw new Error('the period has not started');",
  '}',
].join('\n');

const shouting = [
  '---',
  'language: typescript',
  '---',
  'export default function (input: Input): Output {',
  "  throw new Error('x'.repeat(30_000_000));",
  '}',
].join('\n');

const catching = workflowSource(
  'catching',
  `do:
  - compute:
      try:
        - shout:
            call: run_definition
            with: { type: computation, name: shouting, input: '\${ $data }' }
      catch:
        errors:
          with: { status: 409 }
        as: failure
        do:
          - caught:
              set:
                type: '\${ $failure.type }'
                kind: '\${ $failure.kind }'
                bytes: '\${ encodeURIComponent($failure.detail).replace(/%[0-9A-F]{2}/gu, "_").length }'
`,
);

function report(name: string, computation: string): string {
  return workflowSource(
    name,
    `do:
  - read:
      call: run_definition
      with: { type: reasoning, name: read-rows, input: { campaigns: '\${ $data.campaigns }' } }
      output:
        as: '\${ ({ rows: $data.rows, period: $input.period }) }'
  - compute:
      try:
        - pace:
            call: run_definition
            with: { type: computation, name: ${computation}, input: '\${ $data }' }
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: PT0.05S
          limit:
            attempt: { count: 2 }
  - write:
      call: run_definition
      with: { type: reasoning, name: summary, input: { total_spend_cents: '\${ $data.total_spend_cents }' } }
`,
  );
}

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const rows = campaignRows(100);

function readingRowsThroughTheGraph(): ScriptedReply {
  return (request) =>
    Effect.promise(async (signal) => {
      const echo = request.tools?.offered.find(({ name }) => name === 'graph__echo');
      const reply = await echo?.call(
        { callId: 'call-1', input: { rows: rows['rows'] } },
        { signal, cancelled: signal },
      );
      return jsonResult(decodeJson(reply?.text ?? '{}'));
    });
}

const workflowInput = { campaigns: 'all', period: rows['period'] };

const closing: (() => Promise<void>)[] = [];

const graphs: FakeMcpServer[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function serving(programPoolOf: ProgramPoolOf, ...replies: readonly ScriptedReply[]): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  graphs.splice(0, graphs.length, graph);
  closing.push(graph.close);
  const server = await servingWorkflows(
    replies,
    {
      GRAPH_API_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({
        graph: { url: graph.url, org: 'acme', headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
      }),
    },
    programPoolOf,
  );
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const definitions = [
    ['reasoning', 'read-rows', readRows],
    ['reasoning', 'summary', summary],
    ['computation', 'pace', campaignPace],
    ['computation', 'raising', raising],
    ['workflow', 'report', report('report', 'pace')],
    ['workflow', 'stuck', report('stuck', 'raising')],
    ['computation', 'shouting', shouting],
    ['workflow', 'catching', catching],
  ] as const;
  await definitions.reduce(
    (created: Promise<unknown>, [type, name, source]) =>
      created.then(() => server.call('POST', `${alpha}/definitions/${type}`, { body: { name, source } })),
    Promise.resolve(),
  );
  return server;
}

async function settledWorkflowRun(server: ReasoningServer, workflow: string) {
  const started = await server.call('POST', `${alpha}/definitions/workflow/${workflow}/run`, {
    body: { input: workflowInput },
  });
  return settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
}

async function computationRuns(server: ReasoningServer) {
  return (await server.call('GET', `${alpha}/runs?type=computation`)).body;
}

const decodeListing = Schema.decodeUnknownSync(
  Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
);

async function computedOutput(server: ReasoningServer): Promise<unknown> {
  const [run] = decodeListing(await computationRuns(server)).runs;
  const read = await server.call('GET', `${alpha}/runs/${run?.run_id ?? ''}`);
  return Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Unknown }))(read.body).output;
}

describe('a workflow that reads rows through an MCP server, computes and reasons', () => {
  it('turns the rows into exact totals with a computation function and has a reasoning function write the words', async () => {
    const server = await serving(patientWorkerPool, readingRowsThroughTheGraph(), () =>
      Effect.succeed(textResult('The campaigns spent 2,831.50 in all.')),
    );

    const settled = await settledWorkflowRun(server, 'report');

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'The campaigns spent 2,831.50 in all.' } });
    expect(graphs[0]?.received()).toMatchObject([{ tool: 'echo', arguments: { rows: rows['rows'] } }]);
    expect(await computationRuns(server)).toMatchObject({
      runs: [{ type: 'computation', name: 'pace', status: 'succeeded' }],
    });
    expect(await computedOutput(server)).toMatchObject({ total_spend_cents: 283_150 });
    expect(server.modelCalls()).toBe(2);
  });

  it('retries the computation step after a transient failure, and runs it again', async () => {
    const server = await serving(
      scriptedWorkerPool({ ran: 'stopped', because: 'busy', milliseconds: 10_000 }),
      readingRowsThroughTheGraph(),
      () => Effect.succeed(textResult('Spent.')),
    );

    const settled = await settledWorkflowRun(server, 'report');

    expect(settled).toMatchObject({ body: { status: 'succeeded', output: 'Spent.' } });
    expect(await computationRuns(server)).toMatchObject({
      runs: [
        { name: 'pace', status: 'succeeded' },
        { name: 'pace', status: 'rejected', rejection: { reason: 'unavailable' } },
      ],
    });
  });

  it('does not retry a conflict, since the same input gives the same result, and the workflow ends', async () => {
    const server = await serving(patientWorkerPool, readingRowsThroughTheGraph());

    const settled = await settledWorkflowRun(server, 'stuck');

    expect(settled).toMatchObject({ body: { status: 'rejected' } });
    expect(await computationRuns(server)).toMatchObject({
      runs: [{ name: 'raising', status: 'rejected', rejection: { reason: 'conflict', kind: 'unworkable' } }],
    });
    expect(server.modelCalls()).toBe(1);
  });
});

describe('a workflow whose computation function raises a long error', () => {
  it('catches it as the runtime error of status 409 the format documents, its text cut at 1,024 bytes', async () => {
    const server = await serving(patientWorkerPool);

    const settled = await settledWorkflowRun(server, 'catching');
    const caught = Schema.decodeUnknownSync(
      Schema.Struct({
        body: Schema.Struct({
          status: Schema.Literal('succeeded'),
          output: Schema.Struct({ type: Schema.String, kind: Schema.String, bytes: Schema.Number }),
        }),
      }),
    )(settled).body.output;

    expect(caught).toMatchObject({
      type: 'https://open-workflow-specification.org/spec/1.0.0/errors/runtime',
      kind: 'unworkable',
    });
    expect(caught.bytes).toBeLessThan(1100);
  });
});

describe('the same workflow over MCP', () => {
  it('runs as it does over HTTP', async () => {
    const server = await serving(patientWorkerPool, readingRowsThroughTheGraph(), () =>
      Effect.succeed(textResult('The campaigns spent 2,831.50 in all.')),
    );

    const settled = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      async (session) => {
        const started = await session.callTool('run_definition', {
          type: 'workflow',
          name: 'report',
          input: workflowInput,
        });
        return settledOverMcp(session, String(started.structuredContent?.['run_id']));
      },
    );

    expect(settled.structuredContent).toMatchObject({
      status: 'succeeded',
      output: 'The campaigns spent 2,831.50 in all.',
    });
  });
});
