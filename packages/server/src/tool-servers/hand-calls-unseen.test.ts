import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servingWorkflows, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const onACall = workflowSource(
  'on-a-call',
  'schedule:\n  on: { one: { with: { type: tool_call_started } } }\ndo:\n  - seen: { set: { seen: true } }\n',
);

const onAClosing = workflowSource(
  'on-a-closing',
  'schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - seen: { set: { seen: true } }\n',
);

const foldingWhatItSees = [
  '---',
  'description: The types of the events this view folds, oldest first',
  'language: typescript',
  'source:',
  '  events:',
  '    - type: tool_call_started',
  '    - type: tool_call_answered',
  '    - type: com.acme.ledger.closed',
  'view:',
  '  initial: []',
  '  schema: {type: array, items: {type: string}}',
  '---',
  'export function fold(view: View, event: Event): View {',
  '  return [...view, event.type];',
  '}',
].join('\n');

const RunsSchema = Schema.Struct({ runs: Schema.Array(Schema.Struct({ status: Schema.String })) });

const decodeRuns = Schema.decodeUnknownSync(RunsSchema);

interface CalledPlaybook {
  readonly server: ReasoningServer;
  readonly saved: readonly number[];
}

async function servingACalledPlaybook(): Promise<CalledPlaybook> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingWorkflows([], {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const saving = [
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-a-call', source: onACall } }),
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-a-closing', source: onAClosing } }),
    await server.call('POST', `${alpha}/definitions/recall`, { body: { name: 'seen', source: foldingWhatItSees } }),
  ];
  return { server, saved: saving.map(({ status }) => status) };
}

async function runsOf(server: ReasoningServer, name: string) {
  const { body } = await server.call('GET', `${alpha}/runs?type=workflow&name=${name}`);
  return decodeRuns(body).runs;
}

describe('the calls made by hand in a playbook', () => {
  it('reach no recall function and start no workflow, while the events after them do', async () => {
    const { server, saved } = await servingACalledPlaybook();

    const called = await server.call('POST', `${alpha}/tool-servers/graph/tools/search/execute`, {
      body: { arguments: { query: 'acme' } },
    });
    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'october' } } },
    });
    const triggered = await until(async () => {
      const runs = await runsOf(server, 'on-a-closing');
      expect(runs).toMatchObject([{ status: 'succeeded' }]);
      return runs;
    });
    const recalled = await until(async () => {
      const ran = await server.call('POST', `${alpha}/definitions/recall/seen/run`, { body: {} });
      expect(ran.body).toMatchObject({ status: 'succeeded', output: ['com.acme.ledger.closed'] });
      return ran.body;
    });

    expect(saved).toEqual([201, 201, 201]);
    expect(called).toMatchObject({ status: 200, body: { outcome: 'result' } });
    expect(triggered).toHaveLength(1);
    expect(await runsOf(server, 'on-a-call')).toEqual([]);
    expect(recalled).toMatchObject({ output: ['com.acme.ledger.closed'] });
    expect(await runsOf(server, 'on-a-call')).toEqual([]);
  });
});
