import {
  checkedInput,
  defineCapability,
  outputInWords,
  type PlaybookOwnNames,
  type Capability,
  type DeclaringCapability,
  type RunContext,
} from '@on.auto/definitions';
import type { InvalidInput } from '@on.auto/operations';
import type { Noun } from '@on.auto/phrasing';
import { Effect, type Schema } from 'effect';

import { checkedExpressions, checkedWithoutGoals, type ExpressionCheck } from '../document/expression-check.ts';
import { runnableDocument, workflowReaderOf, type ReadWorkflow } from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import { runPresenter } from '../presenting/run-presenter.ts';
import { started, type WorkflowStarts } from '../runs/run-start.ts';
import { guideVariablesOf } from './guide-variables.ts';

export interface WorkflowAdapterDependencies extends WorkflowStarts {
  readonly check: ExpressionCheck;
  readonly names: PlaybookOwnNames;
  readonly goals?: boolean;
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
  const goals = dependencies.goals ?? false;
  const readWorkflowDocument = workflowReaderOf(dependencies.names, goals);
  return defineCapability({
    type: workflowFacts.type,
    title: 'Workflow',
    guide: { name: 'workflow', variables: guideVariablesOf(dependencies) },
    noun,
    describeOutput: outputInWords('result'),
    mediaType: 'application/yaml',
    parse: (source: string): Effect.Effect<ReadWorkflow, InvalidInput> =>
      readWorkflowDocument(source, dependencies.mostDurationMs),
    check: goals ? checkedExpressions(dependencies.check) : checkedWithoutGoals(dependencies.check),
    summarize: ({ document, contributes }) => summaryOf(document, contributes),
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
