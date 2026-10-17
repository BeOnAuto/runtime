import { listedTools, problemIn, toolNamesIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { answers, jsonResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, settledOverMcp, workflowSource } from '../testing/servers/workflow-server.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const approval = workflowSource(
  'approval',
  `do:
  - judge:
      call: run_definition
      with: { type: reasoning, name: verdict, input: { expense: '\${ $data.expense }' } }
      output:
        as: '\${ ({ approve: $data.approve }) }'
  - decide:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided }
      output:
        as: '\${ ({ decided: $data[0] }) }'
`,
);

const expensing = workflowSource(
  'expensing',
  `input:
  schema:
    document:
      type: object
      required: [expense]
      properties:
        expense: { type: string, description: What was bought }
do:
  - judge:
      call: run_definition
      with: { type: reasoning, name: verdict, input: { expense: '\${ $data.expense }' } }
`,
);

const playbookTools = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
  'list_playbook_events',
  'get_event',
  'publish_event',
  'search',
  'introspect',
  'dry_run',
  'execute',
  'answer_interaction',
  'list_interactions',
  'send_run_event',
];

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function onAlphaOf<T>(served: ReasoningServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${served.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

async function onAlpha<T>(replies: readonly ScriptedReply[], use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingWorkflows(replies);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
  return onAlphaOf(server, use);
}

const typeField = Schema.decodeUnknownSync(
  Schema.Struct({ properties: Schema.Struct({ type: Schema.Struct({ enum: Schema.Array(Schema.String) }) }) }),
);

function typesOfCreateDefinition(listing: unknown): readonly string[] {
  const createDefinition = listedTools(listing).filter(({ name }) => name === 'create_definition');
  return createDefinition.flatMap(({ inputSchema }) => typeField(inputSchema).properties.type.enum);
}

describe('workflows over MCP', () => {
  it('lists twenty tools on the endpoint of a playbook, and every capability in the definition tools', async () => {
    const listing = await onAlpha([], (session) => session.listTools());

    expect(toolNamesIn(listing)).toEqual([...playbookTools, 'get_guide']);
    expect(typesOfCreateDefinition(listing)).toEqual([
      'reasoning',
      'interaction',
      'computation',
      'recall',
      'prediction',
      'workflow',
    ]);
  });

  it('executes a workflow that calls a reasoning function definition and waits for an event the tools send', async () => {
    const { started, sent, run } = await onAlpha([answers(jsonResult({ approve: true }))], async (session) => {
      await session.callTool('create_definition', { type: 'reasoning', name: 'verdict', source: verdict });
      await session.callTool('create_definition', { type: 'workflow', name: 'approval', source: approval });
      const starting = await session.callTool('run_definition', {
        type: 'workflow',
        name: 'approval',
        input: { expense: 'a taxi' },
      });
      const runId = String(starting.structuredContent?.['run_id']);
      const sending = await session.callTool('send_run_event', {
        run_id: runId,
        event: { type: 'com.acme.approval.decided', data: 'yes' },
      });
      return { started: starting, sent: sending, run: await settledOverMcp(session, runId) };
    });

    expect(started.structuredContent).toMatchObject({ type: 'workflow', status: 'started' });
    expect(sent.structuredContent).toMatchObject({ event: { type: 'com.acme.approval.decided', data: 'yes' } });
    expect(run.structuredContent).toMatchObject({ status: 'succeeded', output: { decided: 'yes' } });
  });
});

describe('a workflow whose input schema refuses the input, over MCP', () => {
  it('answers the run with isError and the problem document, each issue at its field under /input', async () => {
    const ran = await onAlpha([], async (session) => {
      await session.callTool('create_definition', { type: 'workflow', name: 'expensing', source: expensing });
      return session.callTool('run_definition', { type: 'workflow', name: 'expensing', input: { expense: 7 } });
    });

    expect({ isError: ran.isError, problem: problemIn(ran) }).toMatchObject({
      isError: true,
      problem: {
        status: 422,
        reason: 'invalid_input',
        kind: 'input_schema',
        errors: [{ pointer: '/input/expense', detail: 'expense, What was bought: expected text.' }],
      },
    });
    expect(server.modelCalls()).toBe(0);
  });
});

const EventsSchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      type: Schema.String,
      data: Schema.Struct({ name: Schema.optionalKey(Schema.String), run_id: Schema.optionalKey(Schema.String) }),
      metadata: Schema.Struct({
        causation_id: Schema.NullOr(Schema.String),
        run_id: Schema.optionalKey(Schema.String),
      }),
    }),
  ),
});

const eventsOf = Schema.decodeUnknownSync(EventsSchema);

type Event = (typeof EventsSchema.Type)['events'][number];

function stepOf(events: readonly Event[], type: string, name: string): Event | undefined {
  return events.find((event) => event.type === type && event.data.name === name);
}

function startOf(events: readonly Event[], runId: string | undefined): Event | undefined {
  return events.find(({ type, metadata }) => type === 'run_started' && metadata.run_id === runId);
}

function causesNamedNowhereIn(events: readonly Event[]): readonly string[] {
  const ids = new Set(events.map(({ id }) => id));
  return events.flatMap(({ metadata: { causation_id: cause } }) => (cause === null || ids.has(cause) ? [] : [cause]));
}

describe('the graph of a workflow run over MCP', () => {
  it('reads the whole tree of a run in the feed of its playbook, its steps with their causes and its child caused by the input that started the call', async () => {
    const tree = await onAlpha([answers(jsonResult({ approve: true }))], async (session) => {
      await session.callTool('create_definition', { type: 'reasoning', name: 'verdict', source: verdict });
      await session.callTool('create_definition', { type: 'workflow', name: 'approval', source: approval });
      const starting = await session.callTool('run_definition', {
        type: 'workflow',
        name: 'approval',
        input: { expense: 'a taxi' },
      });
      const runId = String(starting.structuredContent?.['run_id']);
      await session.callTool('send_run_event', {
        run_id: runId,
        event: { type: 'com.acme.approval.decided', data: 'yes' },
      });
      await settledOverMcp(session, runId);
      return session.callTool('list_playbook_events', { run_id: runId, order: 'asc', limit: 100 });
    });
    const { events } = eventsOf(tree.structuredContent);
    const waiting = stepOf(events, 'step_waiting', 'judge');
    const childStarted = startOf(events, waiting?.data.run_id);

    expect(events.filter(({ type }) => type.startsWith('step_')).length).toBeGreaterThan(0);
    expect(causesNamedNowhereIn(events)).toEqual([]);
    expect(childStarted?.metadata.causation_id).toBe(waiting?.id.slice(0, waiting.id.indexOf('_')));
  });
});
