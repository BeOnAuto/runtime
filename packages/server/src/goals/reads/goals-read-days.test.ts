import { assessmentIdOf, GoalsReadSchema } from '@on.auto/goals';
import { ContextSchema, streamPrefixOfDefinition, type Decider } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { assessing, type Assessing } from '../../testing/goals/assessed-runs.ts';
import { goalOf } from '../../testing/goals/goal-identities.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';

const checksText = [
  '- id: compliance-checks',
  '  statement: All 14 compliance checks pass and report on every run.',
  '  per: run',
  '  window: { after: started, for: PT3M, grace: PT1M }',
  '  success:',
  '    label: Checks in the run that failed or did not report',
  '    settles: on_crossing',
  '    target: { at_most: 0 }',
  '    passed: Passed',
  '    failed: Failed or gone quiet',
  '  milestones:',
  '    - { id: started, label: Started, by: auto }',
  '    - { id: reported, label: All 14 reported, by: auto }',
  '    - { id: outcome, label: Outcome recorded, by: auto }',
  '    - { id: looked-into, label: Looked into, by: person }',
  '  notify: { passed: quiet, failed: quiet, overdue: quiet, through: tell-owner }',
  '',
].join('\n');

const reportedAndPassed = 'All 14 checks reported and passed.';
const oneFailed = '1 of 14 checks failed (backup-restore-test).';
const sixReported = '6 of 14 checks reported, 0 failed.';
const quiet = 'Went quiet: only 9 of 14 checks reported within 3 minutes.';

interface Judged {
  readonly key: string;
  readonly verdict: 'passed' | 'failed';
  readonly at: string;
  readonly by: 'crossing' | 'final' | 'deadline';
  readonly says: string;
}

/** `count` check runs judged a minute apart from `from`, as the goal judged them. */
function judgedFrom(from: string, count: number, judged: Omit<Judged, 'key' | 'at'>): readonly Judged[] {
  return Array.from({ length: count }, (_, minute) => {
    const at = new Date(Date.parse(from) + minute * 60_000).toISOString();
    return { ...judged, key: at, at };
  });
}

/*
 * A few check runs a day, in Pacific time: on Nov 13, 11 passed and then 11 failed, the failures past midnight UTC;
 * on Nov 14 the last pass at 01:00 and 3 misses, the latest two judged at their deadline, whose sentence the day does
 * not take since their measurement is not final; none on Nov 15; 2 misses on Nov 16. A day of 22 and the 12 passes
 * are read in pages of ten.
 */
const judgedRuns: readonly Judged[] = [
  ...judgedFrom('2026-11-13T18:00:00.000Z', 11, { verdict: 'passed', by: 'final', says: reportedAndPassed }),
  ...judgedFrom('2026-11-14T04:00:00.000Z', 11, { verdict: 'failed', by: 'crossing', says: oneFailed }),
  ...judgedFrom('2026-11-14T09:00:00.000Z', 1, { verdict: 'passed', by: 'final', says: reportedAndPassed }),
  ...judgedFrom('2026-11-14T10:00:00.000Z', 1, { verdict: 'failed', by: 'final', says: quiet }),
  ...judgedFrom('2026-11-14T10:30:00.000Z', 2, { verdict: 'failed', by: 'deadline', says: sixReported }),
  ...judgedFrom('2026-11-16T20:00:00.000Z', 2, { verdict: 'failed', by: 'final', says: quiet }),
];

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const verbatim: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

const milestones = [
  { id: 'started', label: 'Started', by: 'auto' },
  { id: 'reported', label: 'All 14 reported', by: 'auto' },
  { id: 'outcome', label: 'Outcome recorded', by: 'auto' },
  { id: 'looked-into', label: 'Looked into', by: 'person' },
];

const rule = {
  settles: 'on_crossing',
  target: { at_most: 0 },
  window: { after: 'started', for: 'PT3M', grace: 'PT1M' },
};

function factsOf({ key, verdict, at: judgedAt, by, says }: Judged): readonly Fact[] {
  const per = `run-${key}`;
  const context = { at: judgedAt, by: 'playbook:alpha' };
  const source = { record: `record-${key}`, run: `run-of-${key}`, workflow: 'watch-compliance-checks', version: 1 };
  return [
    {
      type: 'goal_assessment_opened',
      data: { goal_version: 1, per: { id: per }, rule, milestones },
      context,
    },
    {
      type: 'goal_observed',
      data: {
        source: { ...source, entry: 1, item: 0 },
        at: judgedAt,
        measurement:
          by === 'deadline'
            ? { value: 0, final: false, as_of: judgedAt }
            : { value: verdict === 'passed' ? 0 : 5, final: true, as_of: judgedAt },
        title: `Check run ${per}`,
        says,
      },
      context,
    },
    { type: 'goal_assessed', data: { verdict, at: judgedAt, by, told: 'quiet' }, context },
  ];
}

async function judgedUnderTheGoal(served: Assessing): Promise<void> {
  const ledger = await served.ledger();
  const definition = await goalOf(served, 'compliance-checks');
  const prefix = streamPrefixOfDefinition({ org: 'acme', definition });
  await Effect.runPromise(
    Effect.forEach(
      judgedRuns,
      (judged) => {
        const stream = `${prefix}assessments/${assessmentIdOf({ definition, per: `run-${judged.key}` })}`;
        return Effect.forEach(
          factsOf(judged),
          ({ type, data, context }) =>
            ledger.execute(stream, verbatim, { type, data, context: { ...context, definitionId: definition } }),
          { discard: true },
        );
      },
      { discard: true },
    ),
  );
}

const exactly = Schema.decodeUnknownSync(GoalsReadSchema, { onExcessProperty: 'error' });

const DayRead = Schema.Struct({
  items: Schema.Array(Schema.Struct({ id: Schema.String, outcome: Schema.String, at: Schema.String })),
  next_cursor: Schema.NullOr(Schema.String),
});

const pacific = encodeURIComponent('America/Los_Angeles');

async function itemsOf(path: string, cursor = '', read: readonly string[] = []): Promise<readonly string[]> {
  const { body } = await assessed.server.call('GET', `${alpha}/goals/compliance-checks/${path}${cursor}`);
  const page = Schema.decodeUnknownSync(DayRead)(body);
  const outcomes = [...read, ...page.items.map(({ outcome }) => outcome)];
  return page.next_cursor === null
    ? outcomes
    : itemsOf(path, `&cursor=${encodeURIComponent(page.next_cursor)}`, outcomes);
}

function itemsOfTheDay(day: string, outcome = ''): Promise<readonly string[]> {
  return itemsOf(`days/${day}?time_zone=${pacific}${outcome}`);
}

let assessed: Assessing;

beforeAll(async () => {
  const ledger = temporaryLedger();
  assessed = await assessing({ ledger, goals: checksText });
  await judgedUnderTheGoal(assessed);
  return async () => {
    await assessed.server.stop();
    ledger.remove();
  };
});

describe('the days of a goal whose check runs a preview runtime judged', () => {
  it('counts what each day in Pacific time judged and passed, with the sentence of the latest judged on its measurement, the last pass and the misses since, as its ledger holds them', async () => {
    const { status, body } = await assessed.server.call(
      'GET',
      `${alpha}/goals?time_zone=${pacific}&days=7&until=2026-11-16`,
    );
    const [read] = exactly(body).goals;

    expect(status).toBe(200);
    expect(read?.assessments.closed).toMatchObject({
      days: {
        counts: [
          { day: '2026-11-16', judged: 2, passed: 0, says: quiet },
          { day: '2026-11-15', judged: 0, passed: 0 },
          { day: '2026-11-14', judged: 4, passed: 1, says: quiet },
          { day: '2026-11-13', judged: 22, passed: 11, says: oneFailed },
        ],
      },
      last_passed: { at: '2026-11-14T09:00:00.000Z' },
      misses_since: { at: '2026-11-14T10:00:00.000Z', count: 5 },
    });
  });

  it('reads one day of them ten at a time, newest first, to the last', async () => {
    expect(await itemsOfTheDay('2026-11-13')).toHaveLength(22);
  });

  it('reads the misses of a day alone, and the passes of the whole goal alone, ten at a time', async () => {
    const missed = await itemsOfTheDay('2026-11-13', '&outcome=failed');
    const passed = await itemsOf('results?outcome=passed');

    expect(missed).toHaveLength(11);
    expect(new Set(missed)).toEqual(new Set(['failed']));
    expect(passed).toHaveLength(12);
    expect(new Set(passed)).toEqual(new Set(['passed']));
  });

  it('refuses an outcome a result cannot end with, and a goal the playbook does not hold', async () => {
    const outcome = await assessed.server.call('GET', `${alpha}/goals/compliance-checks/results?outcome=missed`);
    const goal = await assessed.server.call('GET', `${alpha}/goals/no-such-goal/results?outcome=failed`);

    expect(outcome.status).toBe(422);
    expect(goal.status).toBe(404);
  });
});
