import {
  checkedInput,
  functionResourceLabels,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
} from '@on.auto/definitions';
import { Conflict, Unavailable, type InvalidInput } from '@on.auto/operations';
import { jsonBytesOf } from '@on.auto/workflow-engine/dsl';
import type { KeptView, ViewsPort } from '@on.auto/workflow-host';
import { Effect, type Schema } from 'effect';

import type { Answered } from './answer-endings.ts';
import { answerOf, type RecallRunOptions, type RunnableRecall } from './view-answer.ts';
import { rebuildingDetail, stalledDetail } from './view-words.ts';

export type RecallRun = (
  runnable: RunnableRecall,
  input: Schema.Json,
  run: RunContext,
) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;

function rebuilding(views: ViewsPort, { org, playbook, definition }: RunContext, kept: KeptView | undefined) {
  return views.newestRecordAt({ org, playbook }).pipe(
    Effect.flatMap((newestAt) =>
      Effect.fail(
        new Unavailable({
          detail: rebuildingDetail(definition.name, definition.version, kept, newestAt),
          kind: 'rebuilding',
        }),
      ),
    ),
  );
}

function recordOf(kept: KeptView, answered: Answered, input: Schema.Json): Schema.JsonObject {
  return {
    language: 'typescript',
    work: answered.work,
    duration_ms: Math.round(answered.milliseconds),
    input_bytes: jsonBytesOf(input),
    output_bytes: answered.bytes,
    view: {
      version: kept.version,
      checkpoint: kept.checkpoint,
      checkpoint_at: kept.checkpointAt,
      folded: kept.folded,
      last_event: kept.lastEvent === null ? null : { id: kept.lastEvent.id, time: kept.lastEvent.time },
    },
  };
}

function answeredFrom(
  options: RecallRunOptions,
  runnable: RunnableRecall,
  kept: KeptView,
  input: Schema.Json,
): Effect.Effect<CapabilityAnswer, Conflict | Unavailable> {
  return answerOf(options, runnable, kept.view, input).pipe(
    Effect.map((answered) => ({ output: answered.output, record: recordOf(kept, answered, input) })),
  );
}

function ranOn(options: RecallRunOptions, runnable: RunnableRecall, run: RunContext, input: Schema.Json) {
  return (kept: KeptView | undefined): Effect.Effect<CapabilityAnswer, Conflict | Unavailable> => {
    if (kept?.version !== run.definition.version || kept.phase === 'rebuilding' || kept.phase === 'waiting') {
      return rebuilding(options.views, run, kept);
    }
    if (kept.stall !== undefined) {
      return Effect.fail(new Conflict({ detail: stalledDetail(run.definition.name, kept.stall), kind: 'stalled' }));
    }
    return answeredFrom(options, runnable, kept, input);
  };
}

export function recallRun(options: RecallRunOptions): RecallRun {
  return (runnable, input, run) =>
    checkedInput(input, runnable.document.input.schema, functionResourceLabels.recall.singular).pipe(
      Effect.flatMap((admitted): Effect.Effect<CapabilityAnswer, CapabilityRejection | InvalidInput> =>
        options.views
          .viewOf({ org: run.org, playbook: run.playbook }, run.definition.name)
          .pipe(Effect.flatMap(ranOn(options, runnable, run, admitted))),
      ),
    );
}
