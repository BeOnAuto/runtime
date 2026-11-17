import { assessmentIdOf, GoalsReadSchema } from '@on.auto/goals';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { ContextSchema, Ledger, type Decider } from '@on.auto/operations';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { assessing } from '../../testing/goals/assessed-runs.ts';
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

const title = 'Check run run-20261117-0320 at 03:20 UTC';

const quiet = 'Went quiet: only 9 of 14 checks reported within 3 minutes.';

const startedBy = {
  record: '99ed838c-d9df-5230-a18b-9b88e722055c',
  run: '1e81652a-8cdf-5e4c-b122-17fdd28f9e0e',
  workflow: 'watch-compliance-checks',
  version: 1,
};

const endedBy = {
  record: '0cd966d1-95c0-5455-beee-8d9ff29a6ed6',
  run: 'a62e4700-99b8-556d-b0ae-94569923f0f9',
  workflow: 'watch-compliance-checks',
  version: 1,
};

const byThePlaybook = (at: string) => ({ at, by: 'playbook:alpha' });

const recordedBefore: readonly Fact[] = [
  {
    type: 'goal_assessment_opened',
    data: {
      goal: 'compliance-checks',
      goals_version: 1,
      per: { id: 'run-20261117-0320' },
      rule: {
        settles: 'on_crossing',
        target: { at_most: 0 },
        window: { after: 'started', for: 'PT3M', grace: 'PT1M' },
      },
      milestones,
    },
    context: byThePlaybook('2026-11-17T03:20:06.686Z'),
  },
  {
    type: 'goal_observed',
    data: {
      source: { ...startedBy, entry: 0, item: 0 },
      at: '2026-11-17T03:20:06.644Z',
      marks: 'started',
      title,
      window: {
        opens: '2026-11-17T03:20:06.644Z',
        closes: '2026-11-17T03:23:06.644Z',
        due: '2026-11-17T03:24:06.644Z',
      },
    },
    context: byThePlaybook('2026-11-17T03:20:06.686Z'),
  },
  {
    type: 'goal_observed',
    data: {
      source: { ...startedBy, entry: 1, item: 0 },
      at: '2026-11-17T03:20:06.644Z',
      measurement: { value: 0, final: false, as_of: '2026-11-17T03:20:06.005Z' },
      title,
      says: '9 of 14 checks reported, 0 failed.',
    },
    context: byThePlaybook('2026-11-17T03:20:06.686Z'),
  },
  {
    type: 'goal_observed',
    data: {
      source: { ...endedBy, entry: 1, item: 3 },
      at: '2026-11-17T03:23:06.180Z',
      measurement: { value: 5, final: true, as_of: '2026-11-17T03:23:00.000Z' },
      title,
      says: quiet,
    },
    context: byThePlaybook('2026-11-17T03:23:06.205Z'),
  },
  {
    type: 'goal_assessed',
    data: {
      verdict: 'failed',
      at: '2026-11-17T03:23:06.180Z',
      by: 'crossing',
      told: 'quiet',
      source: { ...endedBy, entry: 1, item: 3 },
    },
    context: byThePlaybook('2026-11-17T03:23:06.205Z'),
  },
  {
    type: 'goal_observed',
    data: { source: { ...endedBy, entry: 3, item: 3 }, at: '2026-11-17T03:23:06.180Z', marks: 'outcome' },
    context: byThePlaybook('2026-11-17T03:23:06.205Z'),
  },
];

const checkRun = assessmentIdOf({ goal: 'compliance-checks', per: 'run-20261117-0320' });

async function recordedByAnEarlierRelease(fileName: string): Promise<void> {
  const before = ManagedRuntime.make(ledgerLayer({ fileName, projections: [] }));
  const ledger = await before.runPromise(Ledger);
  await Effect.runPromise(
    Effect.forEach(
      recordedBefore,
      (fact) => ledger.execute(`playbook/acme/alpha/assessments/${checkRun}`, verbatim, fact),
      { discard: true },
    ),
  );
  await before.dispose();
}

const exactly = Schema.decodeUnknownSync(GoalsReadSchema, { onExcessProperty: 'error' });

describe('the goals read of a store whose check run a release before this one judged', () => {
  it('serves the quiet run with the milestones it marked, when and by which run, and the sentence it was judged on, with nothing marked it did not mark', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    await recordedByAnEarlierRelease(ledger.fileName);
    const assessed = await assessing({ ledger, goals: checksText });
    onTestFinished(() => assessed.server.stop());

    const { status, body } = await assessed.server.call('GET', `${alpha}/goals`);
    const [checks] = exactly(body).goals;

    expect(status).toBe(200);
    expect(checks?.assessments.closed.latest).toEqual([
      {
        id: checkRun,
        outcome: 'failed',
        by: 'crossing',
        at: '2026-11-17T03:23:06.180Z',
        per: { id: 'run-20261117-0320', title },
        window: {
          opens: '2026-11-17T03:20:06.644Z',
          closes: '2026-11-17T03:23:06.644Z',
          due: '2026-11-17T03:24:06.644Z',
        },
        value: 5,
        rule: { settles: 'on_crossing', target: { at_most: 0 } },
        milestones,
        marks: [
          { milestone: 'started', at: '2026-11-17T03:20:06.644Z', run: startedBy.run },
          { milestone: 'outcome', at: '2026-11-17T03:23:06.180Z', run: endedBy.run },
        ],
        measurement: {
          value: 5,
          final: true,
          as_of: '2026-11-17T03:23:00.000Z',
          at: '2026-11-17T03:23:06.180Z',
          run: endedBy.run,
          says: quiet,
        },
        final_measurement: {
          value: 5,
          as_of: '2026-11-17T03:23:00.000Z',
          at: '2026-11-17T03:23:06.180Z',
          run: endedBy.run,
        },
      },
    ]);
  });
});
