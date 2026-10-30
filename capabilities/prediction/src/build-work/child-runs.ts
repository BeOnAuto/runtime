import { nestedRunId, recordedRunIn, type RecordedRun } from '@on.auto/definitions';
import { playbookCallerOf, type Lineage, type StreamReader } from '@on.auto/operations';
import type { Effect, Schema } from 'effect';

import type { BuildAddress } from '../builds/build-state.ts';
import type { ChildStarted, StartChild } from '../capability/prediction-ports.ts';

export const requestReference = '/request';

export const approvalReference = '/approval';

export const childReferences: ReadonlySet<string> = new Set([requestReference, approvalReference]);

const interactionType = 'interaction';

export function childIdOf(build: string, reference: string): string {
  return nestedRunId(build, reference, 1);
}

export interface ChildAsked {
  readonly build: BuildAddress;
  readonly reference: string;
  readonly name: string;
  readonly input: Schema.Json;
  readonly lineage: Lineage;
}

export function startedChild(
  runs: StartChild,
  { build, reference, name, input, lineage }: ChildAsked,
  { depth, callDepth }: Pick<RecordedRun, 'depth' | 'callDepth'>,
): Effect.Effect<ChildStarted> {
  const { org, playbook, id } = build;
  return runs({
    org,
    playbook,
    caller: playbookCallerOf(build),
    type: interactionType,
    name,
    input,
    runId: childIdOf(id, reference),
    lineage,
    depth,
    callDepth: callDepth + 1,
    calledBy: { run_id: id, reference, run: 1 },
  });
}

export function childRunOf(
  reader: StreamReader,
  build: BuildAddress,
  reference: string,
): Effect.Effect<RecordedRun | undefined> {
  return recordedRunIn(reader, { ...build, id: childIdOf(build.id, reference) });
}
