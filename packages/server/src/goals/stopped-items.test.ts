import { GoalsReadSchema, noAssessments, type Assessments } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { savedWorkflow } from '../testing/goals/assessed-runs.ts';
import { movingUntil, servedWatched, type WatchedServer } from '../testing/goals/watched-goals.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { createdWithGoals } from '../testing/settings/goals-kept.ts';

const noShot = 'No source record for this shot was found in Drive, so nothing was revised.';

const goals = [
  '- id: change-requests',
  '  name: Change requests',
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
  '    - { id: drafted, label: Reply drafted, by: auto }',
  '    - { id: approved, label: Approved, by: person }',
  '  notify: { passed: quiet, failed: quiet, overdue: quiet }',
  '',
].join('\n');

const find = [
  'contributes:',
  '  - goal: change-requests',
  '    purpose: Finds each change request.',
  '    each: /requests',
  '    per_id: /id',
  '    title: /change',
  '    marks: found',
  'do:',
  "  - found: { set: { requests: [{ id: '${ $input.id }', change: Swap the logo on the letterhead }] } }",
];

const prepare = [
  'contributes:',
  '  - goal: change-requests',
  '    purpose: Says whether the revision is ready.',
  '    per_id: /id',
  '    measures: /ready',
  '    final: true',
  '    says: /note',
  'do:',
  `  - stop-without-a-shot: { set: { id: letterhead, ready: 0, note: '${noShot}' } }`,
];

const goalsReadOf = Schema.decodeUnknownSync(GoalsReadSchema);

async function playbookServed(): Promise<WatchedServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const watched = await servedWatched(ledger);
  onTestFinished(watched.server.stop);
  expect((await createdWithGoals(watched.server, { goals })).status).toBe(201);
  expect(await savedWorkflow(watched.server, 'find-requests', find)).toBe(201);
  expect(await savedWorkflow(watched.server, 'prepare-revision', prepare)).toBe(201);
  return watched;
}

function ran(watched: WatchedServer, name: string, body: Readonly<Record<string, unknown>>) {
  return watched.server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body });
}

async function requestsOf(watched: WatchedServer): Promise<Assessments> {
  const { body } = await watched.server.call('GET', `${alpha}/goals`);
  const [read] = goalsReadOf(body).goals;
  return read?.assessments ?? noAssessments;
}

describe('runs started by hand on a Node server', () => {
  it('count toward the goal and say so, unless started as a test, and an item whose final measurement cannot meet its target is stopped with the run’s words, open until its due time', async () => {
    const watched = await playbookServed();

    const tried = await ran(watched, 'find-requests', { input: { id: 'banner' }, test: true });
    const counted = await ran(watched, 'find-requests', { input: { id: 'letterhead' } });
    const opened = await movingUntil(
      watched,
      () => requestsOf(watched),
      ({ open_count: open }) => open >= 1,
    );
    await ran(watched, 'prepare-revision', {});
    const stopped = await movingUntil(
      watched,
      () => requestsOf(watched),
      ({ stopped_count: stoppedCount }) => stoppedCount === 1,
    );

    expect(tried.status).toBe(200);
    expect(JSON.stringify(tried.body)).not.toContain('notices');
    expect(counted.body).toMatchObject({ notices: [{ kind: 'counts_toward_goals', certainty: 'exact' }] });
    expect(opened.open_count).toBe(1);
    expect(stopped.open_count).toBe(1);
    expect(stopped.in_flight[0]).toMatchObject({
      verdict: 'open',
      next: 'revised',
      stopped: { reason: noShot },
      measurement: { value: 0, final: true },
    });
  });
});
