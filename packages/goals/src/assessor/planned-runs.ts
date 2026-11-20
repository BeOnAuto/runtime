import type { HeldGoal } from '@on.auto/definitions/goals';
import type { Ledger, PlaybookAddress, RecordedEvent } from '@on.auto/operations';

import { assessmentIdOf, identityOfObservation } from '../assessments/assessment-identity.ts';
import type { CallerRule } from '../chain-origins/chain-origin.ts';
import type { ChainReads } from '../chain-origins/chain-origins.ts';
import type { RunConditions } from '../conditions/run-conditions.ts';
import type { Observation, RefusedObservation } from '../observations/observation.ts';
import type { RunOutputs } from '../run-outputs/run-outputs.ts';
import type { ContributedVersions } from './contributed-versions.ts';

export interface PlanParts<E> {
  readonly ledger: Ledger['Service'];
  readonly chainsOf: (playbook: PlaybookAddress) => ChainReads<E>;
  readonly callers: CallerRule;
  readonly outputsOf: (playbook: PlaybookAddress) => RunOutputs;
  readonly conditions: RunConditions;
  readonly versions: ContributedVersions;
}

export interface PlannedRecord {
  readonly playbook: PlaybookAddress;
  readonly playbookKey: string;
  readonly record: RecordedEvent;
}

export interface AssessmentPlanned {
  readonly key: string;
  readonly assessment: string;
  readonly held: HeldGoal;
  readonly observations: readonly Observation[];
}

export interface RefusalPlanned {
  readonly key: string;
  readonly definition: string;
  readonly refused: RefusedObservation;
  readonly endedAt: number;
  readonly observedKeys: readonly string[];
}

export interface StoppedPlanned {
  readonly key: string;
  readonly stopped: {
    readonly definition: string;
    readonly assessment: string;
    readonly run: string;
    readonly at: number;
    readonly reason: string;
  };
}

export type ObservedKeysOf = (definition: string) => readonly string[];

export type Planned = AssessmentPlanned | RefusalPlanned | StoppedPlanned;

export type RunPlan = { readonly planned: readonly Planned[] } | { readonly unread: string };

export interface ExtractedOfGoal {
  readonly held: HeldGoal;
  readonly observations: readonly Observation[];
  readonly refused: readonly RefusedObservation[];
}

export const nothingPlanned: RunPlan = { planned: [] };

function refusalsPlanned(
  extracted: readonly ExtractedOfGoal[],
  endedAt: number,
  observedKeysOf: ObservedKeysOf,
): readonly Planned[] {
  const first = new Map<string, RefusalPlanned>();
  for (const { held, refused } of extracted) {
    const { definition } = held;
    for (const refusal of refused) {
      const key = `r:${definition}/${refusal.workflow}`;
      if (!first.has(key)) {
        first.set(key, { key, definition, refused: refusal, endedAt, observedKeys: observedKeysOf(definition) });
      }
    }
  }
  return [...first.values()];
}

function assessmentsPlanned(extracted: readonly ExtractedOfGoal[]): readonly Planned[] {
  const grouped = new Map<string, AssessmentPlanned>();
  for (const { held, observations } of extracted) {
    for (const observation of observations) {
      const assessment = assessmentIdOf(identityOfObservation(held.definition, held.goal, observation));
      const key = `a:${assessment}`;
      const before = grouped.get(key)?.observations ?? [];
      grouped.set(key, { key, assessment, held, observations: [...before, observation] });
    }
  }
  return [...grouped.values()];
}

export function byKey(planned: readonly Planned[]): RunPlan {
  return { planned: planned.toSorted((one, other) => (one.key < other.key ? -1 : 1)) };
}

export function refusedPlan(
  refused: readonly ExtractedOfGoal[],
  endedAt: number,
  observedKeysOf: ObservedKeysOf,
): RunPlan {
  return byKey(refusalsPlanned(refused, endedAt, observedKeysOf));
}

export interface ObservedRun {
  readonly endedAt: number;
  readonly observedKeysOf: ObservedKeysOf;
}

export function observedPlan(extracted: readonly ExtractedOfGoal[], run: ObservedRun): RunPlan {
  return byKey([...assessmentsPlanned(extracted), ...refusalsPlanned(extracted, run.endedAt, run.observedKeysOf)]);
}
