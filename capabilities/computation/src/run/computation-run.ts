import {
  checkedInput,
  checkedWorker,
  functionResourceLabels,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
  type StrippedForms,
} from '@on.auto/definitions';
import { unreadAssetOf } from '@on.auto/definitions/template';
import { Conflict, readInside, type AssetHolding, type InvalidInput } from '@on.auto/operations';
import { jsonBytesOf, pooledJob, type ProgramPool, type ProgramRequest } from '@on.auto/workflow-engine/dsl';
import { Clock, Effect, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';
import { computationBounds, mostKeptBytesRead, mostOutputBytesOf } from './run-bounds.ts';
import { endingOf } from './run-outcome.ts';

export interface ComputationRunOptions {
  readonly pool: ProgramPool;
  readonly assets: AssetHolding;
  readonly deadlineMs: number;
  readonly budget: number;
  readonly memoryBytes: number;
}

export type ComputationRun = (
  document: ComputationFunctionDefinitionDocument,
  input: Schema.Json,
  run: Pick<RunContext, 'org' | 'playbook'>,
  stripped: StrippedForms,
) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;

interface Runnable {
  readonly document: ComputationFunctionDefinitionDocument;
  readonly program: string;
}

const notCompiled = new Conflict({
  detail:
    'The computation function was saved without the program its check strips for the sandbox; update it to save it again',
  kind: 'unworkable',
});

function checkedBy({ output }: ComputationFunctionDefinitionDocument): Pick<ProgramRequest, 'worker' | 'context'> {
  return { worker: checkedWorker, context: output.schema?.document ?? null };
}

function requestOf(
  { document, program }: Runnable,
  input: Schema.Json,
  moment: number,
  { deadlineMs, budget, memoryBytes }: Omit<ComputationRunOptions, 'pool' | 'assets'>,
): ProgramRequest {
  return {
    source: program,
    entry: 'default',
    arguments: [input],
    moment,
    budget,
    memoryBytes,
    stackBytes: computationBounds.stackBytes,
    deadlineMs,
    mostOutputBytes: mostOutputBytesOf(memoryBytes),
    ...checkedBy(document),
  };
}

function runnableOf(
  document: ComputationFunctionDefinitionDocument,
  { module }: StrippedForms,
): Effect.Effect<Runnable, Conflict> {
  return module === undefined ? Effect.fail(notCompiled) : Effect.succeed({ document, program: module });
}

function inputReadOf(
  input: Schema.Json,
  { org, playbook }: Pick<RunContext, 'org' | 'playbook'>,
  { assets, memoryBytes }: Pick<ComputationRunOptions, 'assets' | 'memoryBytes'>,
): Effect.Effect<Schema.Json, Conflict | InvalidInput> {
  const bound = {
    most: mostKeptBytesRead(memoryBytes),
    unit: 'bytes',
    reader: 'a computation reads at once',
    remedy: 'give it a part of it',
  } as const;
  return Effect.mapError(
    readInside(input, () => true, { holding: assets, playbook: { org, playbook }, bound }),
    unreadAssetOf,
  );
}

export function computationRun({ pool, assets, ...bounds }: ComputationRunOptions): ComputationRun {
  return (document, input, run, stripped) =>
    Effect.all([
      runnableOf(document, stripped),
      Effect.flatMap(
        checkedInput(input, document.input.schema, functionResourceLabels.computation.singular, 'passed_whole'),
        (admitted) => inputReadOf(admitted, run, { assets, memoryBytes: bounds.memoryBytes }),
      ),
      Clock.currentTimeMillis,
    ]).pipe(
      Effect.flatMap(
        ([runnable, admitted, moment]: readonly [Runnable, Schema.Json, number]): Effect.Effect<
          CapabilityAnswer,
          CapabilityRejection | InvalidInput
        > =>
          pooledJob('computation', (signal) => pool.run(requestOf(runnable, admitted, moment, bounds), signal)).pipe(
            Effect.flatMap((outcome) =>
              endingOf(outcome, {
                document,
                inputBytes: jsonBytesOf(admitted),
                workers: pool.workers,
                heapMegabytes: pool.heapMegabytes,
                ...bounds,
              }),
            ),
          ),
      ),
    );
}
