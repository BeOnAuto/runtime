import type { AssessmentFact } from '../assessments/assessment-facts.ts';
import type { AssessmentState } from '../assessments/assessment-state.ts';
import { factsAtMoment } from '../assessments/judging.ts';
import { openedFact } from '../assessments/opening.ts';
import { clockWorkAt } from '../goal-clock/goal-clock.ts';
import type { GoalRule, Instant } from '../goal-rules/goal-rule.ts';
import type { RefusedObservation } from '../observations/observation.ts';
import { traceLedgerOf, type Appended, type TraceLedger } from './trace-ledger.ts';
import { appliedRun, extractedOf, type TracedGoal, type TracedRun } from './trace-runs.ts';

interface ClockRing {
  readonly reporting?: boolean;
  readonly playbookRetired?: boolean;
}

export interface TraceBook {
  readonly change: (goal: GoalRule) => void;
  readonly run: (run: TracedRun) => readonly Appended[];
  readonly ring: (now: Instant, ring?: ClockRing) => readonly Appended[];
  readonly state: (assessment: string) => AssessmentState;
  readonly facts: (assessment: string) => readonly AssessmentFact[];
  readonly assessments: () => readonly string[];
  readonly refused: () => readonly RefusedObservation[];
}

interface Clock {
  readonly firstSavedAt: Instant;
  readonly latestOpened: () => Instant | undefined;
  readonly opened: (opens: Instant) => void;
}

function rung(
  ledger: TraceLedger,
  traced: TracedGoal,
  clock: Clock,
  at: { readonly now: Instant; readonly ring: ClockRing },
) {
  const playbookRetired = at.ring.playbookRetired ?? false;
  const latestOpened = clock.latestOpened();
  const work = clockWorkAt({
    ...traced,
    now: at.now,
    firstSavedAt: clock.firstSavedAt,
    reporting: at.ring.reporting ?? true,
    playbookRetired,
    ...(latestOpened === undefined ? {} : { latestOpened }),
  });
  const toOpen = work.open === undefined || ledger.holds(work.open.assessment) ? [] : [work.open];
  const opened = toOpen.flatMap(({ assessment, opens, opened: data }) => {
    clock.opened(opens);
    return ledger.appended(assessment, [openedFact(data)]);
  });
  const judged = ledger
    .assessments()
    .flatMap((id) =>
      ledger.appended(id, factsAtMoment(ledger.stateOf(id), { goal: traced.goal, now: at.now, playbookRetired })),
    );
  return [...opened, ...judged];
}

export const tracedGoalId = '019a8f00-0000-7000-8000-00000000a001';

export function traceBookOf(first: GoalRule, firstSavedAt: Instant, definition = tracedGoalId): TraceBook {
  const ledger = traceLedgerOf();
  let latestOpened: Instant | undefined;
  const clock: Clock = {
    firstSavedAt,
    latestOpened: () => latestOpened,
    opened: (opens) => {
      latestOpened = opens;
    },
  };
  const refused: RefusedObservation[] = [];
  let traced: TracedGoal = { definition, goal: first, goalVersion: 1 };
  let records = 0;
  return {
    change: (goal) => {
      traced = { ...traced, goal, goalVersion: traced.goalVersion + 1 };
    },
    run: (run) => {
      records += 1;
      const extracted = extractedOf(traced, run, run.record ?? `record-${records}`);
      refused.push(...extracted.refused);
      return appliedRun(ledger, traced, run, extracted);
    },
    ring: (now, ring = {}) => rung(ledger, traced, clock, { now, ring }),
    state: ledger.stateOf,
    facts: ledger.factsOf,
    assessments: ledger.assessments,
    refused: () => [...refused],
  };
}
