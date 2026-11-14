import type { ContentHolders } from '@on.auto/operations';
import type { DefinitionNames } from '@on.auto/operations/definition-names';
import { memoryLedgerWith, type MemoryLedger, type MemoryLedgerOptions } from '@on.auto/operations/testing';
import { Layer, Logger } from 'effect';

import { runOutcomeMapping } from '../analytics/run-outcome-mapping.ts';
import { definitionTypeOrder } from '../capability/function-terminology.ts';
import { definitionNamesOf, unbounded } from '../identity/definition-names.ts';
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

const harnessNames = definitionNamesOf(
  [...definitionTypeOrder, 'echo', 'probe', 'relay', 'paged', 'resumer', 'tool-user'],
  unbounded,
);

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
    ...(store === undefined ? {} : { store }),
  };
  if (readModel === undefined) {
    return { ledger: memoryLedgerWith(kept), staged: Layer.empty, logged: logs.logged };
  }
  const projection = definitionsReadModelOf(readModel.folds);
  const staged = Layer.succeed(DefinitionsReadModel, stagedOver(readModel.stage, projection));
  return {
    ledger: memoryLedgerWith({ ...kept, projections: [projection] }),
    staged: Layer.mergeAll(staged, Logger.layer([logs.logger])),
    logged: logs.logged,
  };
}
