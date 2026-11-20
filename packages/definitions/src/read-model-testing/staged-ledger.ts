import type { ContentHolders } from '@on.auto/operations';
import { memoryLedgerWith, type MemoryLedger, type MemoryLedgerOptions } from '@on.auto/operations/testing';
import { Layer, Logger } from 'effect';

import { runOutcomeMapping } from '../analytics/run-outcome-mapping.ts';
import { definitionTypeOrder } from '../capability/function-terminology.ts';
import { definitionAndGoalNamesOf, unbounded } from '../identity/names-of-a-playbook.ts';
import { DefinitionsReadModel, stagedOver, type ReadModelStage } from '../read-model-staging/read-model-stage.ts';
import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';
import { runIds } from '../runs/run-starts.ts';
import { capturedLogs, type CapturedLog } from './captured-logs.ts';

type DefinitionNames = NonNullable<MemoryLedgerOptions['definitionNames']>;

export interface ReadModelStaged {
  readonly stage: ReadModelStage;
  readonly folds: readonly string[];
}

export interface StagedLedger {
  readonly ledger: MemoryLedger;
  readonly staged: Layer.Layer<never>;
  readonly logged: () => readonly CapturedLog[];
}

const typesOfTheTests = [
  'acting',
  'asking',
  'checked',
  'echo',
  'keeper',
  'limited',
  'measuring',
  'noticed',
  'outside',
  'paged',
  'paid-call',
  'pending',
  'posting',
  'probe',
  'prompted',
  'prompted-limited',
  'recorded',
  'relay',
  'resumer',
  'system-call',
  'texts',
  'tool-user',
  'words',
];

export function definitionNamesWith(types: readonly string[]): DefinitionNames {
  return definitionAndGoalNamesOf([...definitionTypeOrder, ...types], unbounded);
}

const harnessNames = definitionNamesWith(typesOfTheTests);

export function stagedLedgerOf(
  holders: ContentHolders,
  store: MemoryLedgerOptions['store'],
  readModel: ReadModelStaged | undefined,
  definitionNames: DefinitionNames = harnessNames,
): StagedLedger {
  const logs = capturedLogs();
  const kept = {
    runOutcomes: runOutcomeMapping,
    holders,
    definitionNames,
    runIds,
    ...(store === undefined ? {} : { store }),
  };
  if (readModel === undefined) {
    return { ledger: memoryLedgerWith(kept), staged: Layer.empty, logged: logs.logged };
  }
  const staged = Layer.succeed(DefinitionsReadModel, stagedOver(readModel.stage, readModel.folds));
  return {
    ledger: memoryLedgerWith({ ...kept, projections: definitionsReadModelOf(readModel.folds) }),
    staged: Layer.mergeAll(staged, Logger.layer([logs.logger])),
    logged: logs.logged,
  };
}
