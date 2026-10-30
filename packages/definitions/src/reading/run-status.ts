import type { DeclaredFact } from '../run-work/declared-facts.ts';
import { coreRunFactTypes, isRunEndingType } from '../runs/run-events.ts';
import type { Run } from '../runs/run.ts';

export type RunStatus = Run['status'];

const startedTypes: readonly string[] = coreRunFactTypes.filter((type) => !isRunEndingType(type));

export type StoredTypesByStatus = Readonly<Record<RunStatus, readonly string[]>>;

export function storedTypesByStatus(declared: readonly DeclaredFact[]): StoredTypesByStatus {
  return {
    started: [...startedTypes, ...declared.map(({ type }) => type)],
    succeeded: ['run_succeeded'],
    rejected: ['run_rejected'],
    failed: ['run_failed'],
  };
}
