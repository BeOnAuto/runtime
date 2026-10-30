import { checkedInput, functionResourceLabels, type CapabilityDeclaration } from '@on.auto/definitions';
import type { HostDatabase } from '@on.auto/workflow-host';
import { Clock, Effect, Schema } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { seriesWindow } from '../window/series-window.ts';
import { checkedAnswer } from './answer-check.ts';
import { historyTooShort } from './history-refusal.ts';
import { forecastAt, predictionOf, QuestionSchema } from './question-asked.ts';
import { questionRecordOf } from './question-record.ts';

type QuestionRun = CapabilityDeclaration<PredictionFunctionDefinitionDocument>['run'];

export function questionRunOn(database: Pick<HostDatabase, 'readConsistently'>): QuestionRun {
  return (document, input, context) =>
    Effect.gen(function* () {
      yield* checkedInput(input, document.schemas.question, functionResourceLabels.prediction.singular);
      const question = Schema.decodeUnknownSync(QuestionSchema)(input);
      const { predicts } = document;
      const now = yield* Clock.currentTimeMillis;
      const playbook = { org: context.org, playbook: context.playbook };
      const window = yield* seriesWindow(database, { playbook, document, series: question.series, now });
      const answer = forecastAt(predicts, window);
      if ('refused' in answer) {
        return yield* Effect.fail(
          historyTooShort({ series: question.series, predicts, as: document.data.target.as, window }, answer),
        );
      }
      const output = predictionOf(predicts, window, question, answer.points);
      yield* checkedAnswer(output);
      return { output, record: questionRecordOf(answer, predicts, window) };
    });
}
