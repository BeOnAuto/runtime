import { describe, expect, it, onTestFinished } from 'vitest';

import { savedWorkflow, succeededRunsOf } from '../testing/goals/assessed-runs.ts';
import {
  followerRewound,
  goalFactsIn,
  movingUntil,
  rowsHolding,
  servedWatched,
  type GoalFact,
  type WatchedServer,
} from '../testing/goals/watched-goals.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { createdWithGoals, goalsText, plainGoalId } from '../testing/settings/goals-kept.ts';
import { until } from '../testing/waiting/until.ts';

const aMinuteAndASecond = 61_000;

const manyText = [
  '- id: many-things',
  '  statement: Every thing we track brings in at least one order.',
  '  per: thing',
  '  success:',
  '    label: Orders of the thing',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Ordered',
  '    failed: Not ordered',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

const everyMinute = ['schedule:', '  every: PT1M'];

const tallying = (orders: number) => [
  'contributes:',
  `  - goal: ${plainGoalId}`,
  '    purpose: Counts the orders of the week.',
  '    measures: /orders',
  '  - goal: many-things',
  '    purpose: Counts the orders of each thing.',
  '    each: /things',
  '    per_id: /id',
  '    measures: /n',
  ...everyMinute,
  'do:',
  `  - count: { set: { orders: ${String(orders)}, things: [{ id: twice, n: 1 }, { id: twice, n: 2 }] } }`,
];

const condition = '$data.n >= 0';

const lists = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

const thingsOf = (list: number) =>
  JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ id: `thing-${String(list * 100 + index)}`, n: 1 })));

const fanningOut = [
  'contributes:',
  ...lists.flatMap((list) => [
    '  - goal: many-things',
    `    purpose: Counts the orders of each thing on the ${list} list.`,
    `    each: /${list}`,
    '    per_id: /id',
    '    measures: /n',
    `    when: \${ ${condition} }`,
  ]),
  ...everyMinute,
  'do:',
  `  - fan: { set: { ${lists.map((list, index) => `${list}: ${thingsOf(index)}`).join(', ')} } }`,
];

const olderTally = [...everyMinute, 'do:', '  - count: { set: { orders: 3 } }'];

function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

async function served(ledger: TemporaryLedger, startsAt?: number): Promise<WatchedServer> {
  const watched = await servedWatched(ledger, startsAt);
  onTestFinished(watched.server.stop);
  return watched;
}

async function ranOnce(watched: WatchedServer, name: string): Promise<number> {
  const before = await succeededRunsOf(watched, name);
  return movingUntil(
    watched,
    () => succeededRunsOf(watched, name),
    (runs) => runs > before,
  );
}

interface Settled {
  readonly settled: number;
  readonly all: number;
  readonly delivered: number;
}

function deliveredForEveryRun(watched: WatchedServer, delivered: () => number): Promise<Settled> {
  return movingUntil(
    watched,
    async (): Promise<Settled> => {
      const listed = await watched.server.call('GET', `${alpha}/runs?type=workflow&name=fan-out`);
      return {
        settled: await succeededRunsOf(watched, 'fan-out'),
        all: JSON.stringify(listed.body).split('"run_id"').length - 1,
        delivered: delivered(),
      };
    },
    (runs) => JSON.stringify([runs.settled, runs.delivered]) === JSON.stringify([runs.all, 800 * runs.all]),
  );
}

const ofType = (facts: readonly GoalFact[], type: string) => facts.filter((fact) => fact.type === type);

const plainFacts = (facts: readonly GoalFact[]) => facts.filter(({ stream }) => stream.includes('/assessments/'));

const askedLike = (asked: readonly string[], pattern: Readonly<RegExp>) => asked.filter((one) => pattern.test(one));

describe('the assessor on a Node server', () => {
  it('opens an assessment from a scheduled run, settles it on a later crossing, and takes nothing after the verdict', async () => {
    const ledger = aLedger();
    const watched = await servedWatched(ledger);
    await createdWithGoals(watched.server, { goals: `${goalsText}${manyText}` });
    expect(await savedWorkflow(watched.server, 'tally', tallying(3))).toBe(201);

    await ranOnce(watched, 'tally');
    const opened = await rowsHolding(watched, (rows) => rows.some(({ goal }) => goal === plainGoalId));
    expect(await savedWorkflow(watched.server, 'tally', tallying(30))).toBe(200);
    await ranOnce(watched, 'tally');
    await rowsHolding(watched, (rows) => rows.some(({ verdict }) => verdict === 'passed'));
    const runs = await ranOnce(watched, 'tally');
    await movingUntil(
      watched,
      () => askedLike(watched.watch.asked, /^execute .*\/assessments\//u).length,
      (executed) => executed >= runs,
    );
    await watched.server.stop();
    const facts = plainFacts(goalFactsIn(ledger));
    const observed = ofType(facts, 'goal_observed').map(({ data }) => data);

    expect(opened.find(({ goal }) => goal === plainGoalId)).toMatchObject({ verdict: 'open', open: true });
    expect(facts.map(({ type }) => type)).toEqual([
      'goal_assessment_opened',
      ...observed.map(() => 'goal_observed'),
      'goal_assessed',
    ]);
    expect(facts[0]?.data).toEqual({
      goal: plainGoalId,
      goals_version: 1,
      rule: { settles: 'on_crossing', target: { at_least: 20 } },
      milestones: [],
    });
    expect(observed[0]).toMatchObject({
      source: { workflow: 'tally', version: 1, entry: 0 },
      measurement: { value: 3, final: false },
    });
    expect(observed.at(-1)).toMatchObject({ source: { version: 2 }, measurement: { value: 30 } });
    expect(facts.at(-1)?.data).toMatchObject({
      verdict: 'passed',
      by: 'crossing',
      told: 'quiet',
      source: { workflow: 'tally', version: 2, entry: 0 },
    });
    expect(ofType(goalFactsIn(ledger), 'goal_observation_refused').length).toBeGreaterThan(0);
  }, 240_000);
});

describe('the assessor on a Node server', () => {
  it('makes no assessor call for a playbook without goals but the one read of its clock row a pass', async () => {
    const ledger = aLedger();
    const before = await servingReasoning([], {}, undefined, { ledger });
    await before.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    expect(await savedWorkflow(before, 'tally', olderTally)).toBe(201);
    await before.stop();
    const watched = await served(ledger);

    await ranOnce(watched, 'tally');
    await ranOnce(watched, 'tally');
    await until(
      () => watched.watch.asked.length,
      (asked) => asked >= 2,
    );

    expect(new Set(watched.watch.asked)).toEqual(new Set(['rows goal_clocks acme/alpha']));
    expect([watched.watch.sessions(), watched.watch.evaluations()]).toEqual([0, 0]);
    expect(goalFactsIn(ledger)).toEqual([]);
  });
});

describe('the assessor on a Node server', () => {
  it('reads and evaluates a run that touches 800 assessments once, across the passes its 800 deliveries take', async () => {
    const ledger = aLedger();
    const watched = await servedWatched(ledger);
    await createdWithGoals(watched.server, { goals: `${goalsText}${manyText}` });
    expect(await savedWorkflow(watched.server, 'fan-out', fanningOut)).toBe(201);

    await ranOnce(watched, 'fan-out');
    await watched.server.call('POST', `${alpha}/definitions/workflow/fan-out/pause`, { body: {} });
    const { asked } = watched.watch;
    const executedOf = () => askedLike(asked, /^execute .*\/assessments\//u);
    const failedOf = () => askedLike(asked, /^failed /u).length;
    const runs = await deliveredForEveryRun(watched, () => executedOf().length - failedOf());
    await watched.server.stop();
    const facts = goalFactsIn(ledger);
    const executed = executedOf();
    const failed = failedOf();
    const passes = askedLike(asked, /^rows goal_clocks /u).length;

    expect(runs.settled).toBeGreaterThan(0);
    expect(
      ['goal_assessment_opened', 'goal_observed', 'goal_assessed'].map((type) => ofType(facts, type).length),
    ).toEqual([800, 800, 800]);
    expect([watched.watch.sessions(), watched.watch.evaluations()]).toEqual([runs.settled, 800 * runs.settled]);
    expect(askedLike(asked, /^load .*definitions\/workflow$/u)).toHaveLength(1);
    expect(askedLike(asked, /^load .*goals\/playbook$/u)).toHaveLength(runs.settled);
    expect(askedLike(asked, /^(chain|content|recorded)/u).length).toBeLessThanOrEqual(2 * runs.settled);
    expect([executed.length, new Set(executed).size]).toEqual([800 * runs.settled + failed, 800]);
    expect(passes).toBeGreaterThanOrEqual(8 * runs.settled);
    expect(askedLike(asked, /^(load|execute|rows|count)/u).length).toBe(1 + runs.settled + executed.length + passes);
  }, 240_000);
});

describe('the assessor on a Node server', () => {
  it('changes nothing when a fresh server delivers every run again', async () => {
    const ledger = aLedger();
    const first = await servedWatched(ledger);
    await createdWithGoals(first.server, { goals: `${goalsText}${manyText}` });
    expect(await savedWorkflow(first.server, 'tally', tallying(3))).toBe(201);
    await ranOnce(first, 'tally');
    expect(await savedWorkflow(first.server, 'tally', tallying(30))).toBe(200);
    await ranOnce(first, 'tally');
    await rowsHolding(first, (rows) => rows.some(({ verdict }) => verdict === 'passed'));
    await first.server.call('POST', `${alpha}/definitions/workflow/tally/pause`, { body: {} });
    const stoppedAt = first.clock.now();
    await first.server.stop();
    const held = goalFactsIn(ledger);

    followerRewound(ledger);
    const again = await servedWatched(ledger, stoppedAt + 2 * aMinuteAndASecond);
    await movingUntil(
      again,
      () => askedLike(again.watch.asked, /^execute .*\/assessments\//u).length,
      (executed) => executed >= 2,
    );
    await movingUntil(
      again,
      () => askedLike(again.watch.asked, /^rows goal_refusals /u).length,
      (read) => read >= 2,
    );
    await again.server.stop();

    expect(goalFactsIn(ledger)).toEqual(held);
    expect(ofType(held, 'goal_observation_refused').length).toBeGreaterThan(0);
  }, 240_000);
});
