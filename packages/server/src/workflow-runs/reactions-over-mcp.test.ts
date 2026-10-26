import { withMcpSession, type McpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const closing = workflowSource(
  'close-the-month',
  "schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { month: '${ $data[0].data.month }' } }\n",
);

const ListedRuns = Schema.Struct({
  runs: Schema.Array(
    Schema.Struct({ status: Schema.String, started_by: Schema.Struct({ id: Schema.String, name: Schema.String }) }),
  ),
});

const PlaybookEvents = Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) });

const runsIn = Schema.decodeUnknownSync(ListedRuns);

const eventsIn = Schema.decodeUnknownSync(PlaybookEvents);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function onAlpha<T>(use: (session: McpSession) => Promise<T>): Promise<T> {
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
  return until(
    async () =>
      runsIn((await session.callTool('list_runs', { type: 'workflow', name: 'close-the-month' })).structuredContent),
    (listed) => listed.runs.some(({ status }) => status !== 'started'),
  );
}

describe('a workflow whose trigger is an event, over MCP', () => {
  it('runs as the playbook for an event published to the playbook, and the feed shows the event and the run', async () => {
    const seen = await onAlpha(async (session) => {
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
