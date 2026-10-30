import { foldOf, recallDocument } from '@on.auto/recall/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { liveWith, recalled, servingRecall, standingUntil } from '../testing/servers/recall-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const tallying = workflowSource(
  'tally',
  'schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { tallied: true } }\n',
);

const triggeredRuns = recallDocument(
  foldOf("return [...view, [event.subject, event.caller, event.triggerkind].join(' ')];", 'return view;'),
  [
    'language: typescript',
    'source:',
    '  events:',
    '    - type: run_succeeded',
    '      subject: workflow/tally',
    '      caller: playbook:alpha',
    '      triggerkind: event',
    'view:',
    '  initial: []',
  ].join('\n'),
);

const decodeRuns = Schema.decodeUnknownSync(
  Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String, status: Schema.String })) }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function servingTheTally(): Promise<ReasoningServer> {
  const server = await servingRecall([]);
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'tally', source: tallying } });
  await server.call('POST', `${alpha}/definitions/recall`, { body: { name: 'triggered', source: triggeredRuns } });
  return server;
}

function everyRunEnded(server: ReasoningServer, count: number): Promise<unknown> {
  return until(async () => {
    const { runs } = decodeRuns((await server.call('GET', `${alpha}/runs?type=workflow&name=tally`)).body);
    expect(runs.filter(({ status }) => status === 'succeeded')).toHaveLength(count);
  });
}

describe('a recall function whose source names the subject, the caller and the trigger kind', () => {
  it('folds the runs the playbook started for an event, and not the run a caller started', async () => {
    const server = await servingTheTally();
    const started = await server.call('POST', `${alpha}/definitions/workflow/tally/run`, { body: { input: {} } });
    await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);

    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'september' } } },
    });
    await everyRunEnded(server, 2);
    await standingUntil(server, 'triggered', liveWith(1));
    const answer = await recalled(server, 'triggered', {});

    expect(answer.body).toMatchObject({ status: 'succeeded', output: ['workflow/tally playbook:alpha event'] });
  });
});
