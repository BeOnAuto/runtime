import { GoalsReadSchema } from '@on.auto/goals';
import { Ledger } from '@on.auto/operations';
import { goalsWantedWordsOf } from '@on.auto/playbooks';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { savedWorkflow } from '../../testing/goals/assessed-runs.ts';
import { movingUntil, servedWatched, type WatchedServer } from '../../testing/goals/watched-goals.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha, type ReasoningServer } from '../../testing/servers/reasoning-server.ts';
import {
  createdWithGoals,
  goalsText,
  goalsTextGaps,
  leadGoalId,
  plainGoalId,
  restatedGoalsText,
  savedSourceOf,
  servingReasoningWithGoals,
  versionsOf,
} from '../../testing/settings/goals-kept.ts';

const playbooks = '/v1/orgs/acme/playbooks';

const aShapeThatCannotChange = goalsText.replace('  per: experiment\n', '');

const page = [
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '  views:',
  '    runs: categories',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  '      return { runs: { values: [...(view.runs?.values ?? []), { name: event.type, value: 1 }] } };',
  '    }',
  "runs: '{{ views.runs.values | size }} runs.'",
].join('\n');

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function serving(ledgerOver?: (ledger: Ledger['Service']) => Ledger['Service']): Promise<ReasoningServer> {
  server = await servingReasoningWithGoals([], {}, undefined, ledgerOver === undefined ? {} : { ledgerOver });
  return server;
}

function cuttingTheFirstGoalsWrite(ledger: Ledger['Service']): Ledger['Service'] {
  let cut = false;
  return Ledger.of({
    ...ledger,
    executeMultiStream: (decisions, lineage) => {
      if (cut || !decisions.some(({ stream }) => stream.endsWith('/goals/goal'))) {
        return ledger.executeMultiStream(decisions, lineage);
      }
      cut = true;
      return Effect.die(new Error('The ledger stopped before the goals were written'));
    },
  });
}

const savedGoals = {
  source: savedSourceOf(goalsText),
  versions: versionsOf([leadGoalId, 1], [plainGoalId, 1]),
  gaps: goalsTextGaps,
};

describe('create_playbook on a server that keeps goals', () => {
  it('is refused without goals, with the question for the person, and creates nothing', async () => {
    const { call } = await serving();

    const refused = await call('POST', playbooks, { body: { playbook: 'alpha', name: 'Alpha' } });

    expect(refused).toMatchObject({ status: 422, body: { detail: goalsWantedWordsOf(true) } });
    expect(await call('GET', alpha)).toMatchObject({ status: 404 });
  });

  it('creates the playbook with its goals in its own ledger, which get_playbook then reads', async () => {
    const { call } = await serving();

    const created = await createdWithGoals({ call });

    expect(created).toMatchObject({ status: 201, body: { id: 'alpha', goals: savedGoals } });
    expect(await call('GET', alpha)).toMatchObject({ status: 200, body: { id: 'alpha', goals: savedGoals } });
  });

  it('refuses goals the check refuses, and creates nothing', async () => {
    const { call } = await serving();

    const refused = await call('POST', playbooks, {
      body: { playbook: 'alpha', name: 'Alpha', goals: '- id: first-customer\n' },
    });

    expect(refused).toMatchObject({ status: 422 });
    expect(await call('GET', alpha)).toMatchObject({ status: 404 });
  });

  it('repairs a create whose goals were cut when the same caller creates it again', async () => {
    const { call } = await serving(cuttingTheFirstGoalsWrite);

    expect(await createdWithGoals({ call })).toMatchObject({ status: 500 });
    expect(await call('GET', alpha)).toMatchObject({
      status: 200,
      body: { goals: { gaps: [{ kind: 'no_goal', fixed_by: 'person' }] } },
    });
    expect(await createdWithGoals({ call })).toMatchObject({ status: 201, body: { goals: savedGoals } });
    expect(await createdWithGoals({ call })).toMatchObject({ status: 409 });
  });
});

async function made(): Promise<ReasoningServer> {
  const madeOne = await serving();
  await createdWithGoals(madeOne);
  return madeOne;
}

describe('update_playbook on a server that keeps goals', () => {
  it('saves the page and the goals together, the goal that changed at a new version and the other at its own', async () => {
    const { call } = await made();

    const updated = await call('PUT', alpha, { body: { name: 'Shop', page, goals: restatedGoalsText } });

    const versions = versionsOf([leadGoalId, 2], [plainGoalId, 1]);
    const goals = { source: savedSourceOf(restatedGoalsText), versions, gaps: goalsTextGaps };
    expect(updated).toMatchObject({ status: 200, body: { name: 'Shop', page: { source: page }, goals } });
  });

  it('changes nothing when the goals change a shape that cannot change', async () => {
    const { call } = await made();

    const refused = await call('PUT', alpha, { body: { name: 'Shop', page, goals: aShapeThatCannotChange } });

    expect(refused).toMatchObject({ status: 422, body: { errors: [{ pointer: '/goals/0/per' }] } });
    const read = await call('GET', alpha);
    expect(read).toMatchObject({ status: 200, body: { name: 'Alpha', goals: savedGoals } });
    expect(read.body).not.toHaveProperty('page');
  });

  it('answers the page and the goals as they stand when only the name changes', async () => {
    const { call } = await made();
    await call('PUT', alpha, { body: { page } });

    expect(await call('PUT', alpha, { body: { name: 'Shop' } })).toMatchObject({
      status: 200,
      body: { name: 'Shop', page: { source: page }, goals: savedGoals },
    });
  });

  it('removes the page beside goals that are unchanged', async () => {
    const { call } = await made();
    await call('PUT', alpha, { body: { page } });

    const updated = await call('PUT', alpha, { body: { page: null, goals: goalsText } });

    expect(updated).toMatchObject({ status: 200, body: { goals: savedGoals } });
    expect(updated.body).not.toHaveProperty('page');
  });
});

describe('a refused page on a server that keeps goals', () => {
  it('changes nothing when the page is refused beside goals the check takes', async () => {
    const { call } = await made();

    const refused = await call('PUT', alpha, {
      body: { name: 'Shop', page: `${page}\nresult: Ran.`, goals: restatedGoalsText },
    });

    expect(refused).toMatchObject({ status: 422, body: { errors: [{ pointer: '/page' }] } });
    const read = await call('GET', alpha);
    expect(read).toMatchObject({ status: 200, body: { name: 'Alpha', goals: savedGoals } });
    expect(read.body).not.toHaveProperty('page');
  });
});

const changeRequests = [
  '- id: change-requests',
  '  statement: Every client change request becomes a revised asset, ready for review.',
  '  per: change request',
  '  window: { after: found, for: P1D }',
  '  success:',
  '    label: Revisions ready for review',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Ready for review',
  '    failed: Not ready in time',
  '  milestones:',
  '    - { id: found, label: Request found, by: auto }',
  '    - { id: revised, label: Revision made, by: auto }',
  '    - { id: approved, label: Approved, by: person }',
  '  notify: { passed: quiet, failed: quiet, overdue: quiet }',
  '',
].join('\n');

const findRequests = [
  'contributes:',
  '  - goal: change-requests',
  '    purpose: Finds each change request.',
  '    each: /requests',
  '    per_id: /id',
  '    marks: found',
  'do:',
  "  - found: { set: { requests: [{ id: '${ $input.id }' }] } }",
];

const prepareRevisions = [
  'contributes:',
  '  - goal: change-requests',
  '    purpose: Says whether the revision is ready.',
  '    per_id: /id',
  '    measures: /ready',
  '    final: true',
  'do:',
  '  - revised: { set: { id: letterhead, ready: 1 } }',
];

const decodeGoalsRead = Schema.decodeUnknownSync(GoalsReadSchema);

async function judgedGoalOf(watched: WatchedServer) {
  const [goal] = decodeGoalsRead((await watched.server.call('GET', `${alpha}/goals`)).body).goals;
  return goal;
}

function ranBy(watched: WatchedServer, name: string, input: object) {
  return watched.server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input } });
}

describe('a goal renamed on a server that keeps goals', () => {
  it('is judged on the next run of a workflow that serves it under its new id, the item it had open carried on', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const watched = await servedWatched(ledger);
    onTestFinished(watched.server.stop);
    await createdWithGoals(watched.server, { goals: changeRequests });
    await savedWorkflow(watched.server, 'find-requests', findRequests);
    await savedWorkflow(watched.server, 'prepare-revisions', prepareRevisions);
    await ranBy(watched, 'find-requests', { id: 'letterhead' });
    const opened = await movingUntil(
      watched,
      () => judgedGoalOf(watched),
      (goal) => goal?.assessments.open_count === 1,
    );

    const renamed = await watched.server.call('PUT', alpha, {
      body: { rename_goal: { id: 'change-requests', new_id: 'client-changes' } },
    });
    await ranBy(watched, 'prepare-revisions', {});
    const judged = await movingUntil(
      watched,
      () => judgedGoalOf(watched),
      (goal) => goal?.assessments.closed.passed === 1,
    );

    expect(renamed).toMatchObject({
      status: 200,
      body: {
        goals: { versions: [{ id: 'client-changes', version: 1 }] },
        updated_definitions: [
          { type: 'workflow', name: 'find-requests' },
          { type: 'workflow', name: 'prepare-revisions' },
        ],
      },
    });
    expect(judged?.id).toBe('client-changes');
    expect(judged?.assessments.closed.latest.map(({ id }) => id)).toEqual(
      opened?.assessments.in_flight.map(({ id }) => id),
    );
  });
});
