import type { Goal } from '@on.auto/definitions/goals';

import { assessmentIdOf, identityOfObservation } from '../assessments/assessment-identity.ts';
import type { Observation, RefusedObservation } from '../observations/observation.ts';

export interface AssessmentPlanned {
  readonly key: string;
  readonly assessment: string;
  readonly goal: Goal;
  readonly goalsVersion: number;
  readonly observations: readonly Observation[];
}

export interface RefusalPlanned {
  readonly key: string;
  readonly refused: RefusedObservation;
  readonly endedAt: number;
  readonly observedKeys: readonly string[];
}

export type ObservedKeysOf = (goal: string) => readonly string[];

export type Planned = AssessmentPlanned | RefusalPlanned;

export type RunPlan = { readonly planned: readonly Planned[] } | { readonly unread: string };

export interface ExtractedOfGoal {
  readonly goal: Goal;
  readonly observations: readonly Observation[];
  readonly refused: readonly RefusedObservation[];
}

export const nothingPlanned: RunPlan = { planned: [] };

export function refusalStreamIdOf({ goal, workflow }: Pick<RefusedObservation, 'goal' | 'workflow'>): string {
  return `${goal}.${workflow}`;
}

function refusalsPlanned(
  refused: readonly RefusedObservation[],
  endedAt: number,
  observedKeysOf: ObservedKeysOf,
): readonly Planned[] {
  const first = new Map<string, RefusalPlanned>();
  for (const refusal of refused) {
    const key = `r:${refusalStreamIdOf(refusal)}`;
    if (!first.has(key)) {
      first.set(key, { key, refused: refusal, endedAt, observedKeys: observedKeysOf(refusal.goal) });
    }
  }
  return [...first.values()];
}

function assessmentsPlanned(goalsVersion: number, extracted: readonly ExtractedOfGoal[]): readonly Planned[] {
  const grouped = new Map<string, AssessmentPlanned>();
  for (const { goal, observations } of extracted) {
    for (const observation of observations) {
      const assessment = assessmentIdOf(identityOfObservation(goal, observation));
      const key = `a:${assessment}`;
      const before = grouped.get(key)?.observations ?? [];
      grouped.set(key, { key, assessment, goal, goalsVersion, observations: [...before, observation] });
    }
  }
  return [...grouped.values()];
}

function byKey(planned: readonly Planned[]): RunPlan {
  return { planned: planned.toSorted((one, other) => (one.key < other.key ? -1 : 1)) };
}

export function refusedPlan(
  refused: readonly RefusedObservation[],
  endedAt: number,
  observedKeysOf: ObservedKeysOf,
): RunPlan {
  return byKey(refusalsPlanned(refused, endedAt, observedKeysOf));
}

export interface ObservedRun {
  readonly goalsVersion: number;
  readonly endedAt: number;
  readonly observedKeysOf: ObservedKeysOf;
}

export function observedPlan(extracted: readonly ExtractedOfGoal[], run: ObservedRun): RunPlan {
  return byKey([
    ...assessmentsPlanned(run.goalsVersion, extracted),
    ...refusalsPlanned(
      extracted.flatMap((ofGoal) => ofGoal.refused),
      run.endedAt,
      run.observedKeysOf,
    ),
  ]);
}
