import { assessmentIdOf, identityOfObservation } from '../assessments/assessment-identity.ts';
import { factsObserving } from '../assessments/observing.ts';
import type { EntryRule } from '../goal-rules/entry-rule.ts';
import type { GoalRule, Instant } from '../goal-rules/goal-rule.ts';
import type { ConditionVerdicts, Extracted, Observation } from '../observations/observation.ts';
import { observationsOf } from '../observations/observations.ts';
import type { Appended, TraceLedger } from './trace-ledger.ts';

export interface TracedRun {
  readonly at: Instant;
  readonly entry: Omit<EntryRule, 'goal'>;
  readonly also?: readonly Omit<EntryRule, 'goal'>[];
  readonly output: unknown;
  readonly record?: string;
  readonly when?: ConditionVerdicts;
}

export interface TracedGoal {
  readonly definition: string;
  readonly goal: GoalRule;
  readonly goalVersion: number;
}

function grouped(
  { definition, goal }: TracedGoal,
  observations: readonly Observation[],
): readonly (readonly [string, readonly Observation[]])[] {
  const groups = new Map<string, readonly Observation[]>();
  for (const observation of observations) {
    const id = assessmentIdOf(identityOfObservation(definition, goal, observation));
    groups.set(id, [...(groups.get(id) ?? []), observation]);
  }
  return [...groups];
}

export function extractedOf({ goal }: TracedGoal, run: TracedRun, record: string): Extracted {
  const extracted = [run.entry, ...(run.also ?? [])].map((entry, entryIndex) =>
    observationsOf({
      goal,
      entry: { goal: goal.id, ...entry },
      entryIndex,
      run: { record, run: `run-${record}`, workflow: 'measure', version: 1, ended_at: run.at, output: run.output },
      ...(run.when === undefined ? {} : { when: run.when }),
    }),
  );
  return {
    observations: extracted.flatMap(({ observations }) => observations),
    refused: extracted.flatMap(({ refused }) => refused),
  };
}

export function appliedRun(
  ledger: TraceLedger,
  traced: TracedGoal,
  run: TracedRun,
  extracted: Extracted,
): readonly Appended[] {
  return grouped(traced, extracted.observations).flatMap(([id, observations]) =>
    ledger.appended(
      id,
      factsObserving(ledger.stateOf(id), {
        goal: traced.goal,
        goalVersion: traced.goalVersion,
        observations,
        now: run.at,
      }),
    ),
  );
}
