import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  outputInWords,
  publishedOutputOf,
  type DefinitionSummary,
  type Capability,
} from '@on.auto/definitions';
import { noAssetsHeld, type AssetHolding, type InvalidInput } from '@on.auto/operations';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Result } from 'effect';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';
import { documentCheck, invalidDefinition } from '../document/document-check.ts';
import { parseComputationDocument } from '../document/document-parsing.ts';
import { computationRun } from '../run/computation-run.ts';
import { computationBounds } from '../run/run-bounds.ts';
import { guideVariablesOf } from './guide-variables.ts';

export interface ComputationFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly assets?: AssetHolding;
  readonly deadlineMs?: number;
  readonly budget?: number;
  readonly memoryBytes?: number;
}

function parse(source: string): Effect.Effect<ComputationFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseComputationDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) => Effect.fail(invalidDefinition(issues)),
  });
}

function summarize({ description, input, output }: ComputationFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...publishedOutputOf({ schema: output.schema?.document, shape: output.shape }),
  };
}

export function makeComputationFunctionAdapter({
  pool,
  assets = noAssetsHeld,
  deadlineMs = computationBounds.deadlineMs,
  budget = computationBounds.budget,
  memoryBytes = computationBounds.memoryBytes,
}: ComputationFunctionAdapterOptions): Capability {
  const run = computationRun({ pool, assets, deadlineMs, budget, memoryBytes });
  return defineCapability({
    type: 'computation',
    title: functionCategoryLabels.computation,
    guide: { name: 'computation-function', variables: guideVariablesOf({ memoryBytes }) },
    noun: { one: functionResourceLabels.computation.singular, other: functionResourceLabels.computation.plural },
    describeOutput: outputInWords('result'),
    mediaType: 'text/markdown',
    parse,
    check: documentCheck(pool),
    summarize,
    run: (document, input, context, stripped) => run(document, input, context, stripped),
    longestAnyRunMs: deadlineMs,
  });
}
