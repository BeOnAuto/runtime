import type { ContentHolders } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Layer, Logger } from 'effect';

import { runOutcomeMapping } from '../analytics/run-outcome-mapping.ts';
import { DefinitionsReadModel, stagedOver, type ReadModelStage } from '../read-model-staging/read-model-stage.ts';
import { definitionsReadModelOf } from '../read-model/definitions-read-model.ts';
import { capturedLogs, type CapturedLog } from './captured-logs.ts';

export interface ReadModelStaged {
  readonly stage: ReadModelStage;
  readonly folds: readonly string[];
}

export interface StagedLedger {
  readonly ledger: MemoryLedger;
  readonly staged: Layer.Layer<never>;
  readonly logged: () => readonly CapturedLog[];
}

export function stagedLedgerOf(
  holders: ContentHolders,
  store: Parameters<typeof memoryLedger>[3],
  readModel: ReadModelStaged | undefined,
): StagedLedger {
  const logs = capturedLogs();
  if (readModel === undefined) {
    return { ledger: memoryLedger(runOutcomeMapping, [], holders, store), staged: Layer.empty, logged: logs.logged };
  }
  const projection = definitionsReadModelOf(readModel.folds);
  const staged = Layer.succeed(DefinitionsReadModel, stagedOver(readModel.stage, projection));
  return {
    ledger: memoryLedger(runOutcomeMapping, [projection], holders, store),
    staged: Layer.mergeAll(staged, Logger.layer([logs.logger])),
    logged: logs.logged,
  };
}
