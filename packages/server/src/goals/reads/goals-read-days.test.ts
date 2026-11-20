import { readFileSync } from 'node:fs';

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

const JudgedRun = Schema.Tuple([
  Schema.String,
  Schema.Literals(['passed', 'failed']),
  Schema.Number,
  Schema.Literals(['crossing', 'final', 'deadline']),
  Schema.Number,
]);

const Recorded = Schema.Struct({
  recorded: Schema.String,
  says: Schema.Array(Schema.String),
  judged: Schema.Array(JudgedRun),
});

const recorded = Schema.decodeUnknownSync(Recorded)(
  JSON.parse(readFileSync(new URL('compliance-judged.json', import.meta.url), 'utf8')),
);

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

type Judged = typeof JudgedRun.Type;

function factsOf([key, verdict, at, by, said]: Judged): readonly Fact[] {
  const per = `run-${key}`;
  const judgedAt = new Date(at).toISOString();
  const context = { at: judgedAt, by: 'playbook:alpha' };
  const says = recorded.says[said];
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
        ...(says === undefined ? {} : { says }),
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
      recorded.judged,
      (judged) => {
        const stream = `${prefix}assessments/${assessmentIdOf({ definition, per: `run-${judged[0]}` })}`;
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
}, 300_000);

describe('the days of a goal whose check runs a preview runtime judged', () => {
  it('counts what each day in Pacific time judged and passed, with the sentence of the latest judged on its measurement, the last pass and the misses since, as its ledger holds them', async () => {
    const { status, body } = await assessed.server.call(
      'GET',
      `${alpha}/goals?time_zone=${pacific}&days=7&until=2026-11-16`,
    );
    const [read] = exactly(body).goals;
    const quiet = 'Went quiet: only 9 of 14 checks reported within 3 minutes.';

    expect(status).toBe(200);
    expect(read?.assessments.closed).toMatchObject({
      days: {
        counts: [
          { day: '2026-11-16', judged: 111, passed: 0, says: quiet },
          { day: '2026-11-15', judged: 0, passed: 0 },
          { day: '2026-11-14', judged: 795, passed: 0, says: quiet },
          { day: '2026-11-13', judged: 168, passed: 16 },
        ],
      },
      last_passed: { at: '2026-11-14T05:49:04.681Z' },
      misses_since: { at: '2026-11-14T05:51:04.698Z', count: 1035 },
    });
  });

  it('reads one day of them ten at a time, newest first, to the last', async () => {
    expect(await itemsOfTheDay('2026-11-13')).toHaveLength(168);
  });

  it('reads the misses of a day alone, and the passes of the whole goal alone, ten at a time', async () => {
    const missed = await itemsOfTheDay('2026-11-13', '&outcome=failed');
    const passed = await itemsOf('results?outcome=passed');

    expect(missed).toHaveLength(152);
    expect(new Set(missed)).toEqual(new Set(['failed']));
    expect(passed).toHaveLength(16);
    expect(new Set(passed)).toEqual(new Set(['passed']));
  });

  it('refuses an outcome a result cannot end with, and a goal the playbook does not hold', async () => {
    const outcome = await assessed.server.call('GET', `${alpha}/goals/compliance-checks/results?outcome=missed`);
    const goal = await assessed.server.call('GET', `${alpha}/goals/no-such-goal/results?outcome=failed`);

    expect(outcome.status).toBe(422);
    expect(goal.status).toBe(404);
  });
});
