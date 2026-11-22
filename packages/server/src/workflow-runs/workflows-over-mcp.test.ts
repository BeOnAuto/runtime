import { listedTools, type McpSession, problemIn, toolNamesIn, withMcpSession } from '@on.auto/api/testing';
import { statement } from '@on.auto/ledger';
import { answers, jsonResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { toolsInsideAPlaybook as playbookTools } from '../testing/servers/served-tool-names.ts';
import { servingWorkflows, settledOverMcp, workflowSource } from '../testing/servers/workflow-server.ts';
import { whenHeld } from '../testing/waiting/until.ts';

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

let server: ReasoningServer;

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

const closing = workflowSource(
  'close-the-month',
  "schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { month: '${ $data[0].data.month }' } }\n",
);

function queuedClosing(definitionKey: string) {
  return {
    org: 'acme',
    playbook: 'alpha',
    definitionKey,
    workflow: 'close-the-month',
    version: 1,
    runId: 'run-1',
    input: [
      {
        specversion: '1.0',
        id: 'event-1',
        source: '/ledger',
        type: 'com.acme.ledger.closed',
        time: '2026-10-01T09:00:00Z',
        data: { month: 'september' },
      },
    ],
    depth: 1,
    cause: 'record-1',
    trigger: { kind: 'event', reference: '/schedule/on' },
  };
}

const ListedRuns = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({ status: Schema.String, started_by: Schema.Struct({ id: Schema.String, name: Schema.String }) }),
  ),
});

const PlaybookEvents = Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) });

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const eventsIn = Schema.decodeUnknownSync(PlaybookEvents);

async function onAlphaReactions<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingWorkflows([]);
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

function endedRuns(session: McpSession): Promise<typeof ListedRuns.Type> {
  return whenHeld(
    async () =>
      runsIn((await session.callTool('list_runs', { type: 'workflow', name: 'close-the-month' })).structuredContent),
    (listed) => listed.runs.some(({ status }) => status !== 'started'),
  );
}

describe('workflows over mcp', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('workflows over MCP', () => {
    it('lists twenty-seven tools on the endpoint of a playbook, and every capability in the definition tools', async () => {
      const listing = await onAlpha([], (session) => session.listTools());

      expect(toolNamesIn(listing)).toEqual([...playbookTools, 'get_guide']);
      expect(typesOfCreateDefinition(listing)).toEqual([
        'reasoning',
        'lookup',
        'interaction',
        'prediction',
        'computation',
        'generation',
        'workflow',
      ]);
    });

    it('executes a workflow that calls a reasoning function definition and waits for an event the tools send', async () => {
      const { started, sent, run } = await onAlpha([answers(jsonResult({ approve: true }))], async (session) => {
        await session.callTool('create_definition', {
          type: 'reasoning',
          name: 'verdict',
          source: verdict,
          diagram: 'none',
        });
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
          errors: [
            { pointer: '/input/expense', detail: 'expense, What was bought: expected text; it was given a number.' },
          ],
        },
      });
      expect(server.modelCalls()).toBe(0);
    });
  });

  describe('the graph of a workflow run over MCP', () => {
    it('reads the whole tree of a run in the feed of its playbook, its steps with their causes and its child caused by the input that started the call', async () => {
      const tree = await onAlpha([answers(jsonResult({ approve: true }))], async (session) => {
        await session.callTool('create_definition', {
          type: 'reasoning',
          name: 'verdict',
          source: verdict,
          diagram: 'none',
        });
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
});

const refusalOf = Schema.decodeUnknownSync(
  Schema.Struct({
    reason: Schema.String,
    errors: Schema.Array(Schema.Struct({ pointer: Schema.String, detail: Schema.String })),
  }),
);

const onAnIssue = `schedule:
  on:
    one:
      with: { type: com.github.issues.opened, source: /connections/github, subject: acme/site }
do:
  - note: { set: { a: 1 } }
`;

describe('reactions over mcp', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the starts of a workflow queued for a later minute, over MCP', () => {
    it('are listed without what their event carries, and get_definition counts them', async () => {
      const ledger = temporaryLedger();
      onTestFinished(ledger.remove);
      server = await servingReasoning([], {}, undefined, { ledger });
      const due = Date.parse('2100-01-01T00:00:00.000Z');
      await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
        session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
      );
      const seen = await onAlphaOf(server, async (session) => {
        const created = await session.callTool('create_definition', {
          type: 'workflow',
          name: 'close-the-month',
          source: closing,
        });
        const definitionKey = `definition/acme/${String(created.structuredContent?.['definition_id'])}/`;
        await onTheLedgerIn(ledger.fileName, (connection) =>
          connection.write(statement`INSERT INTO workflow_reaction_backlog (definition_key, run_id, start, due)
            VALUES (${definitionKey}, 'run-1', ${JSON.stringify(queuedClosing(definitionKey))}, ${due})`),
        );
        return {
          listed: await session.callTool('list_queued_starts', { workflow: 'close-the-month' }),
          read: await session.callTool('get_definition', { type: 'workflow', name: 'close-the-month' }),
        };
      });

      expect(seen.listed.structuredContent).toMatchObject({
        status: 'active',
        queued_starts: [
          {
            run_id: 'run-1',
            event: { id: 'event-1', type: 'com.acme.ledger.closed', source: '/ledger', time: '2026-10-01T09:00:00Z' },
            due: '2100-01-01T00:00:00.000Z',
            attempts: 0,
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      expect(JSON.stringify(seen.listed)).not.toContain('september');
      expect(seen.read.structuredContent).toMatchObject({
        standing: { queued: 1, next_queued_start: '2100-01-01T00:00:00.000Z' },
      });
    });
  });

  describe('a workflow whose trigger is an event, over MCP', () => {
    it('runs as the playbook for an event published to the playbook, and the feed shows the event and the run', async () => {
      const seen = await onAlphaReactions(async (session) => {
        await session.callTool('create_definition', { type: 'workflow', name: 'close-the-month', source: closing });
        await session.callTool('publish_event', {
          event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'september' } },
        });
        const runs = await endedRuns(session);
        const feed = await session.callTool('list_playbook_events', { order: 'asc' });
        return { runs, feed: eventsIn(feed.structuredContent).events.map(({ type }) => type) };
      });

      expect(seen.runs.runs).toEqual([{ status: 'succeeded', started_by: { id: 'playbook:alpha', name: 'alpha' } }]);
      expect(seen.feed).toEqual(expect.arrayContaining(['event_published', 'run_started', 'run_succeeded']));
    });
  });

  describe('a connection’s events, over MCP', () => {
    it('refuse a workflow whose trigger names a connection this runtime does not receive from, and an event published under a connection’s source', async () => {
      const seen = await onAlphaReactions(async (session) => {
        await server.call('POST', '/v1/orgs/acme/connections', { body: { provider: 'github' } });
        const onIssues = await session.callTool('create_definition', {
          type: 'workflow',
          name: 'on-issues',
          source: workflowSource('on-issues', onAnIssue),
        });
        const asAConnection = await session.callTool('publish_event', {
          event: { source: '/connections/ledger', type: 'com.acme.ledger.closed', data: { month: 'august' } },
        });
        return { onIssues, asAConnection };
      });

      const refused = refusalOf(problemIn(seen.onIssues));
      expect(refused.reason).toBe('invalid_input');
      expect(
        refused.errors.map(({ pointer, detail }) => [pointer, detail.includes('/schedule/on/one/with/type')]),
      ).toEqual([['/source', true]]);
      expect({ isError: seen.asAConnection.isError, problem: problemIn(seen.asAConnection) }).toMatchObject({
        isError: true,
        problem: { reason: 'invalid_input', errors: [{ pointer: '/event/source' }] },
      });
    });
  });
});
