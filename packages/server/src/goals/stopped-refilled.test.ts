import { assessmentIdOf, goalsLedger } from '@on.auto/goals';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { ContextSchema, Ledger, type Decider } from '@on.auto/operations';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';

const studio = { org: 'acme', playbook: 'studio' };

const FactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type Fact = typeof FactSchema.Type;

const verbatim: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

const noShot = 'No source record for this shot was found in Drive, so nothing was revised.';

const milestones = [
  { id: 'found', label: 'Request found', by: 'auto' },
  { id: 'revised', label: 'Revision made', by: 'auto' },
  { id: 'drafted', label: 'Reply drafted', by: 'auto' },
  { id: 'approved', label: 'Approved', by: 'person' },
];

const letterhead = assessmentIdOf({ goal: 'change-requests', per: 'letterhead' });

const byThePlaybook = (at: string) => ({ at, by: 'playbook:studio' });

const window = {
  opens: '2026-11-16T21:25:00.000Z',
  closes: '2026-11-17T21:25:00.000Z',
  due: '2026-11-17T22:25:00.000Z',
};

const recordedBefore: readonly Fact[] = [
  {
    type: 'goal_assessment_opened',
    data: {
      goal: 'change-requests',
      goals_version: 1,
      per: { id: 'letterhead' },
      rule: { settles: 'on_crossing', target: { at_least: 1 }, window: { after: 'found', for: 'P1D' } },
      milestones,
    },
    context: byThePlaybook('2026-11-16T21:25:01.000Z'),
  },
  {
    type: 'goal_observed',
    data: {
      source: { record: 'record-find', run: 'run-find', workflow: 'find-change-requests', version: 2, entry: 0 },
      at: '2026-11-16T21:25:00.000Z',
      marks: 'found',
      title: 'Swap the logo on the letterhead',
      window,
    },
    context: byThePlaybook('2026-11-16T21:25:01.000Z'),
  },
  {
    type: 'goal_observed',
    data: {
      source: { record: 'record-prepare', run: 'run-prepare', workflow: 'prepare-revision', version: 2, entry: 2 },
      at: '2026-11-16T21:26:00.000Z',
      measurement: { value: 0, final: true, as_of: '2026-11-16T21:26:00.000Z' },
      says: noShot,
    },
    context: byThePlaybook('2026-11-16T21:26:01.000Z'),
  },
];

function ledgerOn(fileName: string, goalsKept: boolean) {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName, projections: goalsKept ? goalsLedger.projections : [] }));
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(Ledger);
}

describe('a store whose goal facts a release before stopped items recorded', () => {
  it('opens with goal_assessments_3 filled from the facts, the letterhead request stopped by its run with its words, open until its due', async () => {
    const file = temporaryLedger();
    onTestFinished(file.remove);
    const before = await ledgerOn(file.fileName, false);
    await Effect.runPromise(
      Effect.forEach(
        recordedBefore,
        (fact) => before.execute(`playbook/acme/studio/assessments/${letterhead}`, verbatim, fact),
        { discard: true },
      ),
    );

    const after = await ledgerOn(file.fileName, true);
    const [kept] = await Effect.runPromise(
      after.readProjectedRows('goal_assessments', studio, { where: [], orderBy: [], order: 'asc', limit: 5 }),
    );

    expect(kept?.key).toBe(letterhead);
    expect(kept?.row).toMatchObject({
      open: true,
      verdict: 'open',
      next_milestone: 'revised',
      window_due: Date.parse(window.due),
      stopped_at: Date.parse('2026-11-16T21:26:00.000Z'),
      stopped_run: 'run-prepare',
    });
    expect(String(kept?.row['state'])).toContain(noShot);
  });
});
