import type { Contributes, Goal } from '@on.auto/definitions/goals';
import type { RecordedEvent } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import type { ConditionedEntry, RunVerdicts } from '../conditions/run-conditions.ts';
import { observedEntryKeyOf } from '../goal-tables/observation-rows.ts';
import type { Contribution, ContributedRun, RefusedObservation } from '../observations/observation.ts';
import { observationsOf, outputGoneRefusal } from '../observations/observations.ts';
import type { ExtractedOfGoal } from './planned-runs.ts';

interface FinishedRun {
  readonly name: string;
  readonly version: number;
  readonly run: string;
}

interface KnownEntry {
  readonly goal: Goal;
  readonly entry: Contributes[number];
  readonly index: number;
}

function endedOf(
  endings: readonly string[],
  { type, context }: Pick<RecordedEvent, 'type' | 'context'>,
): FinishedRun | undefined {
  const { definitionType, definitionName: name, definitionVersion: version, runId: run } = context;
  if (!endings.includes(type) || definitionType !== 'workflow') {
    return undefined;
  }
  return name === undefined || version === undefined || run === undefined ? undefined : { name, version, run };
}

export function finishedRunOf(record: Pick<RecordedEvent, 'type' | 'context'>): FinishedRun | undefined {
  return endedOf(['run_succeeded'], record);
}

export interface FailedRun extends FinishedRun {
  readonly reason: string;
}

const mostReasonCharacters = 200;

const RejectedSchema = Schema.Struct({ rejection: Schema.Struct({ detail: Schema.String }) });

const rejectedOf = Schema.decodeUnknownOption(RejectedSchema);

export const failedRunWords = 'The run failed before it finished.';

function reasonOf({ type, data }: Pick<RecordedEvent, 'type' | 'data'>): string {
  const detail = type === 'run_rejected' ? Option.getOrUndefined(rejectedOf(data))?.rejection.detail : undefined;
  return (detail ?? failedRunWords).slice(0, mostReasonCharacters);
}

export function failedRunOf(record: Pick<RecordedEvent, 'type' | 'context' | 'data'>): FailedRun | undefined {
  const ended = endedOf(['run_failed', 'run_rejected'], record);
  return ended === undefined ? undefined : { ...ended, reason: reasonOf(record) };
}

export function knownEntriesOf(contributes: Contributes, goals: readonly Goal[]): readonly KnownEntry[] {
  return contributes.flatMap((entry, index) => {
    const goal = goals.find(({ id }) => id === entry.goal);
    return goal === undefined ? [] : [{ goal, entry, index }];
  });
}

export function observedKeysOf(known: readonly KnownEntry[], run: FinishedRun): (goal: string) => readonly string[] {
  return (goal) =>
    known.flatMap(({ goal: { id }, index }) =>
      id === goal ? [observedEntryKeyOf({ workflow: run.name, version: run.version, entry: index })] : [],
    );
}

export function conditionedOf(contributes: Contributes, known: readonly KnownEntry[]): readonly ConditionedEntry[] {
  const indexes = new Set(known.map(({ index }) => index));
  return contributes.map(({ when, each }, index) =>
    indexes.has(index) && when !== undefined ? { when, ...(each === undefined ? {} : { each }) } : {},
  );
}

export function contributedRunOf(
  { id, context }: Pick<RecordedEvent, 'id' | 'context'>,
  run: FinishedRun,
  output: unknown,
): ContributedRun {
  return {
    record: id,
    run: run.run,
    workflow: run.name,
    version: run.version,
    ended_at: Date.parse(context.at),
    output,
  };
}

function contributionOf(known: KnownEntry, run: ContributedRun): Omit<Contribution, 'when'> {
  return { goal: known.goal, entry: known.entry, entryIndex: known.index, run };
}

export function goneRefusalsOf(known: readonly KnownEntry[], run: ContributedRun): readonly RefusedObservation[] {
  return known.map((entry) => outputGoneRefusal(contributionOf(entry, run)));
}

export function extractedOf(
  known: readonly KnownEntry[],
  run: ContributedRun,
  verdicts: RunVerdicts,
): readonly ExtractedOfGoal[] {
  return known.map((entry) => {
    const when = verdicts[entry.index];
    const contribution = contributionOf(entry, run);
    const extracted = observationsOf(when === undefined ? contribution : { ...contribution, when });
    return { goal: entry.goal, observations: extracted.observations, refused: extracted.refused };
  });
}
