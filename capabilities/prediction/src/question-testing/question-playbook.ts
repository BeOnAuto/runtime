import {
  defineCreateDefinition,
  defineGetDefinition,
  defineRunDefinition,
  runOutcomeMapping,
  type PlaybookOperation,
} from '@on.auto/definitions';
import { memoryLedger } from '@on.auto/operations/testing';
import type { HostDatabase } from '@on.auto/workflow-host';
import type { Clock } from 'effect';

import { predictionFunctionOf } from '../capability/prediction-function.ts';
import { datasetsPortOn } from '../dataset/datasets-port.ts';
import { poolOf } from '../testing/prediction-runs.ts';
import { playbookCalls, type PlaybookCall } from './playbook-calls.ts';

interface PlaybookOperations {
  readonly create: PlaybookOperation;
  readonly run: PlaybookOperation;
  readonly get: PlaybookOperation;
}

export interface QuestionPlaybook {
  readonly call: PlaybookCall;
  readonly operations: PlaybookOperations;
}

interface QuestionPlaybookOptions {
  readonly clock: Clock.Clock;
  readonly database: Pick<HostDatabase, 'readConsistently'>;
  readonly datasets: HostDatabase;
}

export function questionPlaybook({ clock, database, datasets }: QuestionPlaybookOptions): QuestionPlaybook {
  const prediction = predictionFunctionOf({ pool: poolOf(), database, datasets: datasetsPortOn(datasets) });
  const capabilities = [prediction];
  return {
    call: playbookCalls(memoryLedger(runOutcomeMapping), clock),
    operations: {
      create: defineCreateDefinition(capabilities),
      run: defineRunDefinition(capabilities),
      get: defineGetDefinition(capabilities),
    },
  };
}
