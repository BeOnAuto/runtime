import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
} from '@on.auto/definitions';
import type { CapabilityDatabase, CapabilityPool, CapabilityPorts, ProvidedCapability } from '@on.auto/workflow-host';

import { predictionCheck } from '../checks/prediction-check.ts';
import { datasetsProvidedOn } from '../dataset/dataset-folder.ts';
import { datasetsPortOn, type DatasetsPort } from '../dataset/datasets-port.ts';
import { questionRunOn } from '../question/question-run.ts';
import { predictionStanding } from '../standing/prediction-standing.ts';
import { predictionBounds, predictionDefinitionType } from './prediction-bounds.ts';
import { parse, summarize } from './prediction-definitions.ts';
import { describeOutput } from './prediction-words.ts';

export interface PredictionFunctionParts {
  readonly pool: Pick<CapabilityPool, 'check'>;
  readonly database: Pick<CapabilityDatabase, 'readConsistently'>;
  readonly datasets: DatasetsPort;
  readonly mostFunctions?: number;
}

export function predictionFunctionOf({
  pool,
  database,
  datasets,
  mostFunctions = predictionBounds.mostFunctions,
}: PredictionFunctionParts): Capability {
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

export function makePredictionFunctionAdapter(ports: CapabilityPorts): ProvidedCapability {
  const { pool, database, mostFunctions } = ports;
  return {
    capability: predictionFunctionOf({ pool, database, datasets: datasetsPortOn(database), mostFunctions }),
    ...datasetsProvidedOn(ports),
  };
}
