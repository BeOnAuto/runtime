import {
  checkedInput,
  defineCapability,
  outputInWords,
  type PlaybookOwnNames,
  type Capability,
  type DeclaringCapability,
  type RunContext,
} from '@on.auto/definitions';
import type { InvalidInput, Noun } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { checkedExpressions, type ExpressionCheck } from '../document/expression-check.ts';
import { runnableDocument, workflowReaderOf, type ReadWorkflow } from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import { runPresenter } from '../presenting/run-presenter.ts';
import { started, type WorkflowStarts } from '../runs/run-start.ts';

export interface WorkflowAdapterDependencies extends WorkflowStarts {
  readonly check: ExpressionCheck;
  readonly names: PlaybookOwnNames;
}

export const workflowFacts: DeclaringCapability = { type: 'workflow', facts: { onRuns: [], streams: [runPresenter] } };

const noun: Noun = { one: 'workflow', other: 'workflows' };

function admittedInput(
  { inputSchema }: ReadWorkflow,
  input: Schema.Json,
  { trigger }: RunContext,
): Effect.Effect<Schema.Json, InvalidInput> {
  return trigger === undefined ? checkedInput(input, inputSchema, noun.one) : Effect.succeed(input);
}

export function makeWorkflowAdapter(dependencies: WorkflowAdapterDependencies): Capability {
  const readWorkflowDocument = workflowReaderOf(dependencies.names);
  return defineCapability({
    type: workflowFacts.type,
    title: 'Workflow',
    guide: { name: 'workflow' },
    noun,
    describeOutput: outputInWords('result'),
    mediaType: 'application/yaml',
    parse: (source: string): Effect.Effect<ReadWorkflow, InvalidInput> =>
      readWorkflowDocument(source, dependencies.mostDurationMs),
    check: checkedExpressions(dependencies.check),
    summarize: ({ document }) => summaryOf(document),
    run: (read, input, run, stripped) =>
      Effect.flatMap(admittedInput(read, input, run), (admitted) =>
        started(dependencies, runnableDocument(read.document, stripped), admitted, run),
      ),
    whenCancelled: 'finish',
    finishesLater: true,
    longestRunOf: () => dependencies.mostDurationMs,
    facts: workflowFacts.facts,
  });
}
