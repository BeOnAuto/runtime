import type { EntryRule } from '../goal-rules/entry-rule.ts';
import type { GoalRule, Instant } from '../goal-rules/goal-rule.ts';

export interface ObservationSource {
  readonly record: string;
  readonly run: string;
  readonly workflow: string;
  readonly version: number;
  readonly entry: number;
  readonly item?: number;
}

export interface ObservedMeasurement {
  readonly value: number;
  readonly final: boolean;
  readonly as_of: Instant;
}

export interface Observation {
  readonly goal: string;
  readonly source: ObservationSource;
  readonly at: Instant;
  readonly per?: string;
  readonly marks?: string;
  readonly measurement?: ObservedMeasurement;
  readonly title?: string;
  readonly link?: string;
  readonly says?: string;
}

export interface RefusedObservation {
  readonly goal: string;
  readonly workflow: string;
  readonly run: string;
  readonly detail: string;
}

export interface ContributedRun {
  readonly record: string;
  readonly run: string;
  readonly workflow: string;
  readonly version: number;
  readonly ended_at: Instant;
  readonly output: unknown;
}

export type ConditionVerdict = boolean | null | { readonly failed: string };

export type ConditionVerdicts = 'not_reached' | readonly ConditionVerdict[];

export interface Contribution {
  readonly goal: GoalRule;
  readonly entry: EntryRule;
  readonly entryIndex: number;
  readonly run: ContributedRun;
  readonly when?: ConditionVerdicts;
}

export interface Extracted {
  readonly observations: readonly Observation[];
  readonly refused: readonly RefusedObservation[];
}
