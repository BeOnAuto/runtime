import { withMcpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const aMinuteAndASecond = 61_000;

const closing = workflowSource(
  'close-the-month',
  [
    'schedule:',
    '  on: { one: { with: { type: com.acme.ledger.closed } } }',
    "  cron: '* * * * *'",
    '  every: PT1M',
    'input:',
    '  schema:',
    '    document: { type: object, required: [month] }',
    'do:',
    "  - keep: { set: { input: '${ $data }' } }",
    '',
  ].join('\n'),
);

const TriggerSchema = Schema.Struct({ kind: Schema.String, reference: Schema.String });

const ListedRuns = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({
      run_id: Schema.String,
      status: Schema.String,
      started_by: Schema.Struct({ id: Schema.String, name: Schema.String }),
    }),
  ),
});

const StartSchema = Schema.Struct({
  type: Schema.String,
  summary: Schema.String,
  metadata: Schema.Struct({ causation_id: Schema.NullOr(Schema.String), trigger: TriggerSchema }),
});

const HistoryPage = Schema.Struct({ events: Schema.NonEmptyArray(Schema.Unknown) });

const Triggers = Schema.Struct({ triggers: Schema.Array(TriggerSchema) });

const SavedDefinition = Schema.Struct({ ...Triggers.fields, triggers_since: Schema.String });

const PlaybookEvents = Schema.Struct({ events: Schema.NonEmptyArray(Schema.Struct({ id: Schema.String })) });

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const historyIn = Schema.decodeUnknownSync(HistoryPage);

const startIn = Schema.decodeUnknownSync(StartSchema);

const definitionIn = Schema.decodeUnknownSync(SavedDefinition);

const ListedDefinitions = Schema.Struct({ definitions: Schema.Array(Triggers) });

const listedIn = Schema.decodeUnknownSync(ListedDefinitions);

const eventsIn = Schema.decodeUnknownSync(PlaybookEvents);

type Start = typeof StartSchema.Type;

interface Seen {
  readonly runs: typeof ListedRuns.Type;
  readonly starts: readonly Start[];
  readonly definition: typeof SavedDefinition.Type;
  readonly eventRecord: string;
  readonly listedOverMcp: typeof ListedDefinitions.Type;
  readonly startOverMcp: Start;
}

let server: ReasoningServer;

let seen: Seen;

function endedRuns(count: number): Promise<typeof ListedRuns.Type> {
  return until(
    async () => runsIn((await server.call('GET', `${alpha}/runs?type=workflow&name=close-the-month`)).body),
    (listed) => listed.runs.filter(({ status }) => status !== 'started').length >= count,
  );
}

async function startOf(runId: string): Promise<Start> {
  return startIn(historyIn((await server.call('GET', `${alpha}/runs/${runId}/history`)).body).events[0]);
}

function startByKind(kind: string): Start | undefined {
  return seen.starts.find(({ metadata }) => metadata.trigger.kind === kind);
}

async function triggeredThreeTimes(): Promise<Seen> {
  const clock = movedClock(Date.now());
  server = await servingWorkflows([], {}, undefined, clock);
  const mcp = { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} };
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await withMcpSession('current revision', mcp, (session) =>
    session.callTool('create_definition', { type: 'workflow', name: 'close-the-month', source: closing }),
  );
  const savedBy = Date.now();
  await server.call('POST', `${alpha}/events`, {
    body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'september' } } },
  });
  await endedRuns(1);
  clock.moveTo(savedBy + aMinuteAndASecond);
  const runs = await endedRuns(3);
  const starts = await Promise.all(runs.runs.map(({ run_id: runId }) => startOf(runId)));
  const newest = runs.runs[0]?.run_id ?? '';
  const overMcp = await withMcpSession('current revision', mcp, async (session) => ({
    listed: listedIn((await session.callTool('list_definitions', { type: 'workflow' })).structuredContent),
    history: historyIn(
      (await session.callTool('list_playbook_events', { run_id: newest, order: 'asc' })).structuredContent,
    ),
  }));
  return {
    runs,
    starts,
    definition: definitionIn((await server.call('GET', `${alpha}/definitions/workflow/close-the-month`)).body),
    eventRecord: eventsIn((await server.call('GET', `${alpha}/events?type=event_published`)).body).events[0].id,
    listedOverMcp: overMcp.listed,
    startOverMcp: startIn(overMcp.history.events[0]),
  };
}

beforeAll(async () => {
  seen = await triggeredThreeTimes();
});

afterAll(async () => {
  await server.stop();
});

const thePlaybook = { id: 'playbook:alpha', name: 'alpha' };

describe('a workflow with an event trigger, a cron schedule and an every schedule', () => {
  it('shows its triggers in the order its document names them, over HTTP and MCP', () => {
    expect(seen.definition.triggers).toEqual([
      { kind: 'event', reference: '/schedule/on' },
      { kind: 'cron', reference: '/schedule/cron' },
      { kind: 'every', reference: '/schedule/every' },
    ]);
    expect(seen.listedOverMcp.definitions).toEqual([{ triggers: seen.definition.triggers }]);
  });

  it('runs as the playbook once for an event and once at a due time of each schedule', () => {
    expect(seen.runs.runs.map(({ status, started_by: by }) => [status, by])).toEqual([
      ['succeeded', thePlaybook],
      ['succeeded', thePlaybook],
      ['succeeded', thePlaybook],
    ]);
    expect(
      seen.starts.map(({ metadata }) => metadata.trigger.kind).toSorted((first, second) => first.localeCompare(second)),
    ).toEqual(['cron', 'event', 'every']);
  });

  it('names in the history of each run the trigger that started it, and what caused it', () => {
    expect([startByKind('event'), startByKind('cron'), startByKind('every')]).toEqual([
      {
        type: 'run_started',
        summary: 'A run of the workflow “close-the-month” was started by its event trigger.',
        metadata: { causation_id: seen.eventRecord, trigger: { kind: 'event', reference: '/schedule/on' } },
      },
      {
        type: 'run_started',
        summary: 'A run of the workflow “close-the-month” was started by its cron schedule.',
        metadata: {
          causation_id: seen.definition.triggers_since,
          trigger: { kind: 'cron', reference: '/schedule/cron' },
        },
      },
      {
        type: 'run_started',
        summary: 'A run of the workflow “close-the-month” was started by its every schedule.',
        metadata: {
          causation_id: seen.definition.triggers_since,
          trigger: { kind: 'every', reference: '/schedule/every' },
        },
      },
    ]);
    expect(seen.startOverMcp).toEqual(seen.starts[0]);
    expect(seen.starts.flatMap(({ summary }) => internalTermsIn(summary))).toEqual([]);
  });
});

describe('a workflow with triggers and an input schema that requires a field their inputs lack', () => {
  it('refuses from a caller the input of a schedule, which its triggered runs above started with', async () => {
    const fromACaller = await server.call('POST', `${alpha}/definitions/workflow/close-the-month/run`, {
      body: { input: { schedule: { due: '2026-10-19T09:00:00.000Z' } } },
    });

    expect(fromACaller).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        kind: 'input_schema',
        errors: [{ pointer: '/input/month', detail: 'The input: expected the field month.' }],
      },
    });
  });
});
