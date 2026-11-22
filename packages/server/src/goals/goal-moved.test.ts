import { GoalsReadSchema } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { savedWorkflow, succeededRunsOf } from '../testing/goals/assessed-runs.ts';
import { goalFactsIn, servedWatched, type GoalFact, type WatchedServer } from '../testing/goals/watched-goals.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { createdWithGoals } from '../testing/settings/goals-kept.ts';
import { testServersStartAt } from '../testing/waiting/stepped-server-clock.ts';

const ofType = (facts: readonly GoalFact[], type: string) => facts.filter((fact) => fact.type === type);

const assessmentsOf = (facts: readonly GoalFact[]) => facts.filter(({ stream }) => stream.includes('/assessments/'));

/** No sweep is stepped: the server's clock never moves. */
const theClockStill = { atMost: 0 };

/** The value once it holds, read once the server is wholly at rest, its clock never moved. */
function whenRested<A>(watched: WatchedServer, read: () => Promise<A>, holds: (value: A) => boolean): Promise<A> {
  return watched.clock.swept.until(read, holds, theClockStill);
}

/** A run of the workflow started by hand in a playbook, once it has succeeded: the count of its runs that have. */
async function ranByHand(watched: WatchedServer, playbook: string): Promise<number> {
  const before = await succeededRunsOf(watched, 'tally', playbook);
  const started = await watched.server.call('POST', `${playbook}/definitions/workflow/tally/run`, { body: {} });
  expect(started.status).toBe(200);
  return whenRested(
    watched,
    () => succeededRunsOf(watched, 'tally', playbook),
    (runs) => runs > before,
  );
}

async function served(
  startsAt: number,
): Promise<{ readonly watched: WatchedServer; readonly facts: () => readonly GoalFact[] }> {
  const ledger = temporaryLedger();
  const watched = await servedWatched(ledger, startsAt);
  onTestFinished(async () => {
    await watched.server.stop();
    ledger.remove();
  });
  return { watched, facts: () => goalFactsIn(ledger) };
}

const weekly = (id: string) =>
  [
    `- id: ${id}`,
    '  statement: Keep the weekly orders coming in from the shop.',
    '  window: { calendar: week }',
    '  success: { label: Orders this week, settles: on_crossing, target: { at_least: 20 }, passed: In, failed: Short }',
    '  notify: { passed: quiet, failed: quiet, overdue: quiet }',
    '',
  ].join('\n');

const tallyingTheWeek = (orders: number) => [
  'contributes: [{ goal: weekly-orders, purpose: Counts the orders of the week., measures: /orders }]',
  'do:',
  `  - count: { set: { orders: ${String(orders)} } }`,
];

const beta = '/v1/orgs/acme/playbooks/beta';

const ChangesOf = Schema.decodeUnknownSync(
  Schema.Struct({ cursor: Schema.String, changes: Schema.Array(Schema.Struct({ kind: Schema.String })) }),
);

const week = 604_800_000;

const awayFromTheEndOfAWeek = (now: number) => ((now - 345_600_000) % week > week - 7_200_000 ? now + 10_800_000 : now);

async function goalsReadOf(watched: WatchedServer, playbook: string) {
  return Schema.decodeUnknownSync(GoalsReadSchema)((await watched.server.call('GET', `${playbook}/goals`)).body).goals;
}

/**
 * The runs are started by hand and the server's clock never moves, so each run is the one the test started, no
 * schedule can start another, and the week the goal is judged in is the one it opened in. Each wait reads once the
 * server is wholly at rest, never on an interval.
 */
describe('a goal moved with the workflow that serves it, on a Node server', () => {
  it('is judged on that workflow’s next run in the playbook it moved to, its open week carried on, and is gone from the one it left', async () => {
    const { watched, facts: factsHeld } = await served(awayFromTheEndOfAWeek(testServersStartAt));
    await createdWithGoals(watched.server, { goals: weekly('weekly-orders') });
    await createdWithGoals(watched.server, { playbook: 'beta', name: 'Beta', goals: weekly('beta-orders') });
    expect(await savedWorkflow(watched.server, 'tally', tallyingTheWeek(3))).toBe(201);
    await ranByHand(watched, alpha);
    const [opened] = await whenRested(
      watched,
      () => watched.assessmentRows('weekly-orders'),
      (rows) => rows.length > 0,
    );
    const goal = await watched.goalOf('weekly-orders');
    const { cursor } = ChangesOf((await watched.server.call('GET', `${beta}/changes`)).body);

    const moved = await watched.server.call('POST', `${alpha}/move`, {
      body: { to: 'beta', goals: ['weekly-orders'], definitions: [{ type: 'workflow', name: 'tally' }] },
    });
    const [left, arrived] = [await goalsReadOf(watched, alpha), await goalsReadOf(watched, beta)];
    const changed = ChangesOf((await watched.server.call('GET', `${beta}/changes?since=${cursor}&wait=0`)).body);
    expect(await savedWorkflow(watched.server, 'tally', tallyingTheWeek(30), beta)).toBe(200);
    await ranByHand(watched, beta);
    const passed = await whenRested(
      watched,
      () => goalsReadOf(watched, beta),
      (goals) => goals[1]?.assessments.current?.verdict === 'passed',
    );
    await watched.server.stop();
    const facts = factsHeld().filter(({ stream }) => stream.startsWith(`definition/acme/${goal}/`));

    expect([opened, moved]).toMatchObject([
      { verdict: 'open', open: true },
      { status: 200, body: { goals: ['weekly-orders'] } },
    ]);
    expect([left.map(({ id }) => id), arrived.map(({ id }) => id)]).toEqual([[], ['beta-orders', 'weekly-orders']]);
    expect(arrived[1]?.assessments.current).toMatchObject({ verdict: 'open' });
    expect(passed[1]?.assessments.current).toMatchObject({
      id: arrived[1]?.assessments.current?.id,
      verdict: 'passed',
    });
    expect(changed.changes).toContainEqual({ kind: 'goal' });
    expect(ofType(facts, 'goal_moved')).toHaveLength(1);
    expect(new Set(assessmentsOf(facts).map(({ stream }) => stream)).size).toBe(1);
    expect(ofType(assessmentsOf(facts), 'goal_assessed')).toMatchObject([{ data: { verdict: 'passed' } }]);
  });
});
