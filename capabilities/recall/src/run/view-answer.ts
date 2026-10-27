import { checkedWorker, type BeforeRunDispatch } from '@on.auto/definitions';
import { Conflict, type Unavailable } from '@on.auto/operations';
import { pooledJob, type ProgramPool, type ProgramRequest } from '@on.auto/workflow-engine/dsl';
import type { ViewsPort } from '@on.auto/workflow-host';
import { Clock, Effect, type Schema } from 'effect';

import type { RecallFunctionDefinitionDocument } from '../document/recall-document.ts';
import { answerEndingOf, viewAnswered, type Answered } from './answer-endings.ts';
import { mostOutputBytes, recallBounds } from './recall-bounds.ts';

interface AnswerBounds {
  readonly deadlineMs: number;
  readonly budget: number;
  readonly memoryBytes: number;
}

export interface RecallRunOptions extends AnswerBounds {
  readonly pool: ProgramPool;
  readonly views: ViewsPort;
}

interface Asked {
  readonly view: Schema.Json;
  readonly input: Schema.Json;
  readonly moment: number;
}

type Answering = Effect.Effect<Answered, Conflict | Unavailable>;

export interface RunnableRecall {
  readonly document: RecallFunctionDefinitionDocument;
  readonly program: string | undefined;
}

export interface DispatchingRecall extends RunnableRecall {
  readonly beforeDispatch: BeforeRunDispatch;
}

const notCompiled = new Conflict({
  detail:
    'The recall function was saved without the module its check strips for the sandbox; update it to save it again',
  kind: 'unworkable',
});

function requestOf(
  { document, program }: Readonly<{ document: RecallFunctionDefinitionDocument; program: string }>,
  { view, input, moment }: Asked,
  { deadlineMs, budget, memoryBytes }: AnswerBounds,
): ProgramRequest {
  return {
    source: program,
    entry: 'answer',
    arguments: [view, input],
    moment,
    budget,
    memoryBytes,
    stackBytes: recallBounds.stackBytes,
    deadlineMs,
    mostOutputBytes,
    worker: checkedWorker,
    context: document.output.schema?.document ?? null,
  };
}

function answeredBy(
  { pool, deadlineMs, budget, memoryBytes }: RecallRunOptions,
  { document, program }: Readonly<{ document: RecallFunctionDefinitionDocument; program: string }>,
  asked: Asked,
  beforeDispatch: BeforeRunDispatch,
): Answering {
  const bounds = { deadlineMs, budget, memoryBytes };
  return Effect.andThen(
    Effect.suspend(beforeDispatch),
    pooledJob('program', 'recall', (signal) => pool.run(requestOf({ document, program }, asked, bounds), signal)),
  ).pipe(
    Effect.flatMap((outcome) =>
      answerEndingOf(outcome, {
        foldLine: document.details.foldLine,
        workers: pool.workers,
        heapMegabytes: pool.heapMegabytes,
        ...bounds,
      }),
    ),
  );
}

export function answerOf(
  options: RecallRunOptions,
  { document, program, beforeDispatch }: DispatchingRecall,
  view: Schema.Json,
  input: Schema.Json,
): Answering {
  if (!document.answers) {
    return viewAnswered(view, document.output.schema).pipe(Effect.tap(beforeDispatch));
  }
  return program === undefined
    ? Effect.fail(notCompiled)
    : Effect.flatMap(Clock.currentTimeMillis, (moment) =>
        answeredBy(options, { document, program }, { view, input, moment }, beforeDispatch),
      );
}
