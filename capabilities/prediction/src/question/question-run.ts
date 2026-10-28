import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import { Clock, Effect, Schema } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { checkedAnswer } from './answer-check.ts';
import { answeringModelOf } from './default-forecast.ts';
import { answered } from './model-answers.ts';
import { aheadOf, observedOf, originFormOf, QuestionSchema } from './question-asked.ts';
import { seriesWindow } from './series-window.ts';

const coverage = 0.8;

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
    const model = yield* answeringModelOf(ports, document, {
      playbook,
      name: context.definition.name,
      definitionVersion: context.definition.version,
    });
    const now = yield* Clock.currentTimeMillis;
    const window = yield* seriesWindow(ports, { playbook, document, series: question.series, now });
    const answer = yield* answered({ ports, document, question }, model, window);
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
        version: model.version,
        ...(model.version === null ? { default_forecast: true } : {}),
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
