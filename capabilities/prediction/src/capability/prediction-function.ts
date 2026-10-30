import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
} from '@on.auto/definitions';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import type { HostDatabase } from '@on.auto/workflow-host';

import { predictionCheck } from '../checks/prediction-check.ts';
import type { DatasetsPort } from '../dataset/datasets-port.ts';
import { questionRunOn } from '../question/question-run.ts';
import { predictionStanding } from '../standing/prediction-standing.ts';
import { predictionBounds, predictionDefinitionType } from './prediction-bounds.ts';
import { parse, summarize } from './prediction-definitions.ts';
import { describeOutput } from './prediction-words.ts';

export interface PredictionFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly database: Pick<HostDatabase, 'readConsistently'>;
  readonly datasets: DatasetsPort;
  readonly mostFunctions?: number;
}

export function makePredictionFunctionAdapter({
  pool,
  database,
  datasets,
  mostFunctions = predictionBounds.mostFunctions,
}: PredictionFunctionAdapterOptions): Capability {
  return defineCapability({
    type: predictionDefinitionType,
    title: functionCategoryLabels.prediction,
    guide: { name: 'prediction-function' },
    noun: { one: functionResourceLabels.prediction.singular, other: functionResourceLabels.prediction.plural },
    describeOutput,
    mediaType: 'text/markdown',
    parse,
    check: predictionCheck(pool),
    summarize,
    run: questionRunOn(database),
    longestAnyRunMs: predictionBounds.questionMs,
    mostActive: mostFunctions,
    standing: predictionStanding(datasets),
  });
}
