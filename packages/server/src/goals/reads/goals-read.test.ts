import { openApiPath } from '@on.auto/api';
import { Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../../testing/servers/reasoning-server.ts';
import { workflowSource } from '../../testing/servers/workflow-server.ts';
import {
  createdWithGoals,
  goalsTextGaps,
  leadGoalId,
  plainGoalId,
  restatedGoalsText,
  servingReasoningWithGoals,
} from '../../testing/settings/goals-kept.ts';

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

async function served(
  serving: typeof servingReasoning,
  kept?: ReturnType<typeof temporaryLedger>,
): Promise<ReasoningServer> {
  const on = await serving([], {}, undefined, kept === undefined ? {} : { ledger: kept });
  server = on;
  return on;
}

const marking = [
  'contributes:',
  `  - goal: ${leadGoalId}`,
  '    purpose: Marks the experiments chosen.',
  '    per_id: /experiment',
  '    marks: chosen',
  `  - goal: ${plainGoalId}`,
  '    purpose: Counts the orders of the week.',
  '    measures: /orders',
  'do:',
  '  - count: { set: { orders: 3 } }',
  '',
].join('\n');

const noAssessments = {
  current: null,
  open_count: 0,
  in_flight: [],
  by_milestone: {},
  waiting: {},
  closed: { total: 0, passed: 0, failed: 0, no_result: 0, latest: [] },
};

const kindsOf = (gaps: readonly { readonly kind: string; readonly goal?: string }[]) =>
  gaps.map(({ kind, goal }) => ({ kind, goal }));

const GoalsReadBody = Schema.Struct({
  version: Schema.Number,
  gaps: Schema.Array(Schema.Struct({ kind: Schema.String, goal: Schema.optionalKey(Schema.String) })),
  goals: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      gaps: Schema.Array(Schema.Struct({ kind: Schema.String, goal: Schema.optionalKey(Schema.String) })),
      contributions: Schema.Array(Schema.Unknown),
      assessments: Schema.Unknown,
    }),
  ),
});

const ChangesBody = Schema.Struct({ cursor: Schema.String, changes: Schema.Array(Schema.Unknown) });

describe('the goals read on a Node server that keeps goals', () => {
  it('answers the goals as written, the gaps of each, the contributions and no assessments yet', async () => {
    const on = await served(servingReasoningWithGoals);
    expect(await createdWithGoals(on)).toMatchObject({ status: 201 });
    const before = await on.call('GET', `${alpha}/goals`);
    const save = await on.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'marking', source: workflowSource('marking', marking) },
    });
    const after = await on.call('GET', `${alpha}/goals`);
    const read = Schema.decodeUnknownSync(GoalsReadBody)(after.body);

    expect([before.status, save.status, after.status]).toEqual([200, 201, 200]);
    expect(before.body).toMatchObject({
      version: 1,
      gaps: [],
      goals: [
        { id: leadGoalId, per: 'experiment', contributions: [], assessments: noAssessments },
        { id: plainGoalId, milestones: [], contributions: [], assessments: noAssessments },
      ],
    });
    expect(Schema.decodeUnknownSync(GoalsReadBody)(before.body).goals.flatMap(({ gaps }) => kindsOf(gaps))).toEqual(
      goalsTextGaps,
    );
    expect(read.goals.map(({ contributions }) => contributions)).toEqual([
      [{ workflow: 'marking', purpose: 'Marks the experiments chosen.', marks: 'chosen', measures: false }],
      [{ workflow: 'marking', purpose: 'Counts the orders of the week.', measures: true }],
    ]);
  });
});

describe('the goals read of an older playbook on a Node server that now keeps goals', () => {
  it('answers an empty list, with the gap no_goal', async () => {
    const before = await servingReasoning([], {}, undefined, { ledger });
    await before.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await before.stop();
    const read = await (await served(servingReasoningWithGoals, ledger)).call('GET', `${alpha}/goals`);

    expect(read).toMatchObject({
      status: 200,
      body: { version: 0, gaps: [{ kind: 'no_goal', fixed_by: 'person' }], goals: [] },
    });
  });
});

describe('the goals route', () => {
  it('tells a playbook that is missing from a route that is not served', async () => {
    const missing = await (await served(servingReasoningWithGoals)).call('GET', '/v1/orgs/acme/playbooks/nobody/goals');
    await server?.stop();
    const unserved = await (await served(servingReasoning)).call('GET', '/v1/orgs/acme/playbooks/nobody/goals');

    expect(missing.status).toBe(404);
    expect(missing.body).not.toMatchObject({ detail: 'No route matches the path' });
    expect(unserved).toMatchObject({ status: 404, body: { detail: 'No route matches the path' } });
  });
});

describe('the changes of a playbook on a Node server that keeps goals', () => {
  it('names a goal change, with no fields, in the changes of the playbook when its goals are saved', async () => {
    const on = await served(servingReasoningWithGoals);
    expect(await createdWithGoals(on)).toMatchObject({ status: 201 });
    const { cursor } = Schema.decodeUnknownSync(ChangesBody)((await on.call('GET', `${alpha}/changes`)).body);
    const quiet = await on.call('GET', `${alpha}/changes?since=${cursor}&wait=0`);
    const restated = await on.call('PUT', alpha, { body: { goals: restatedGoalsText } });
    const changed = await on.call('GET', `${alpha}/changes?since=${cursor}&wait=0`);

    expect(quiet).toMatchObject({ status: 200, body: { changes: [] } });
    expect(restated.status).toBe(200);
    expect(changed).toMatchObject({ status: 200, body: { changes: [{ kind: 'goal' }] } });
  });
});

const DocumentSchema = Schema.Struct({
  tags: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.optionalKey(Schema.String) })),
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
});

const goalsPath = '/orgs/{org}/playbooks/{playbook}/goals';

const changesPath = '/orgs/{org}/playbooks/{playbook}/changes';

async function documentServedBy(serving: typeof servingReasoning) {
  const on = await served(serving);
  const { body } = await on.call('GET', openApiPath);
  await on.stop();
  return Schema.decodeUnknownSync(DocumentSchema)(body);
}

describe('the API document of a server that keeps goals', () => {
  it('lists the goals read under a goals tag with a description, and the goal change among the changes', async () => {
    const without = await documentServedBy(servingReasoning);
    const withGoals = await documentServedBy(servingReasoningWithGoals);

    expect(withGoals.paths[goalsPath]).toMatchObject({ get: { operationId: 'get_playbook_goals', tags: ['goals'] } });
    expect(withGoals.tags.find(({ name }) => name === 'goals')?.description).toMatch(/goals as written/u);
    expect(JSON.stringify(withGoals.paths[changesPath])).toContain('"goal"');
    expect(without.paths).not.toHaveProperty([goalsPath]);
    expect(without.tags.map(({ name }) => name)).not.toContain('goals');
    expect(JSON.stringify(without.paths[changesPath])).not.toContain('"goal"');
  });
});
