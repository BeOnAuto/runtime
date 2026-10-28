import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import { Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Option, Schema } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { executingRuntimeOf } from '../runtimes/model-runtimes.ts';
import { activeVersionOf, type ActiveVersion } from './active-version.ts';
import { checkedAnswer } from './answer-check.ts';
import {
  aheadOf,
  askedOf,
  givenOf,
  observedOf,
  originFormOf,
  predictedOf,
  QuestionSchema,
  type Question,
} from './question-asked.ts';
import { seriesWindow, type SeriesWindow } from './series-window.ts';

const coverage = 0.8;

const busy = new Unavailable({ detail: 'Every model process is busy; try again shortly', kind: 'model_process_busy' });

const ended = new Unavailable({ detail: 'The model process ended before it answered', kind: 'model_process_failed' });

function noRuntimeFor({ version, format }: ActiveVersion): Unavailable {
  return new Unavailable({
    detail: `No model runtime this server has installed executes the format ${format} of version ${version}; install the extension that executes it, or ask for a build`,
    kind: 'model_process_failed',
    because: 'no_model_runtime',
  });
}

const notFinite = new Unavailable({
  detail: 'The model answered something other than finite numbers in the shape its signature gives',
  kind: 'model_process_failed',
  because: 'not_finite',
});

interface Answering {
  readonly ports: PredictionPorts;
  readonly playbook: PlaybookAddress;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly question: Question;
}

function answered({ ports, playbook, document, question }: Answering, active: ActiveVersion, window: SeriesWindow) {
  return Effect.gen(function* () {
    const executing = executingRuntimeOf(ports.runtimes, { sha256: active.file, format: active.format });
    if (executing === undefined) {
      return yield* Effect.fail(noRuntimeFor(active));
    }
    const asked = askedOf(document.predicts, window.origin, question);
    const kept = yield* ports.caches.models.pathOf(executing.file, () =>
      ports.ledger.content.get(playbook, active.file),
    );
    const path = Option.getOrThrow(Option.fromNullishOr(kept));
    const outcome = yield* ports.models.run(
      executing.runtime,
      { sha256: active.file, path },
      {
        y: Float32Array.from(window.y),
        x: window.x,
        given: givenOf(document, question, asked.steps),
        h: asked.summed,
        features: document.data.features.length,
        givens: document.data.given.length,
      },
    );
    if (outcome.ended === 'busy') {
      return yield* Effect.fail(busy);
    }
    if (outcome.ended === 'crashed') {
      return yield* Effect.fail(new Unavailable({ detail: outcome.detail, kind: 'model_process_failed' }));
    }
    if (outcome.ended !== 'answered') {
      return yield* Effect.fail(ended);
    }
    const expected = `1,${asked.summed === null ? asked.steps : 1},3`;
    const predicted = predictedOf(outcome.answer.q, document.predicts, asked.points);
    if (outcome.answer.dims.join(',') !== expected || predicted === undefined) {
      return yield* Effect.fail(notFinite);
    }
    return { predicted, runtime: executing.named, milliseconds: outcome.milliseconds };
  });
}

export function questionRun(
  ports: PredictionPorts,
  document: PredictionFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  const playbook = { org: context.org, playbook: context.playbook };
  const question = Schema.decodeUnknownSync(QuestionSchema)(input);
  const { predicts } = document;
  return Effect.gen(function* () {
    const active = yield* activeVersionOf({
      ledger: ports.ledger,
      playbook,
      name: context.definition.name,
      definitionVersion: context.definition.version,
      document,
    });
    const now = yield* Clock.currentTimeMillis;
    const window = yield* seriesWindow(ports, { playbook, document, series: question.series, now });
    const answer = yield* answered({ ports, playbook, document, question }, active, window);
    const origin = originFormOf(predicts, window.origin);
    const ahead = aheadOf(predicts, window.origin);
    const output = {
      unit: predicts.unit,
      period: predicts.period,
      origin,
      lines: [
        { name: 'observed', points: observedOf(window, predicts) },
        { name: ahead.line, points: answer.predicted },
      ],
      ...(question.marks === undefined ? {} : { marks: question.marks }),
    };
    yield* checkedAnswer(output);
    return {
      output,
      record: {
        version: active.version,
        runtime: { ...answer.runtime },
        coverage,
        ...ahead.record,
        origin,
        dataset_checkpoint: window.checkpoint,
        duration_ms: Math.round(answer.milliseconds),
      },
    };
  });
}
