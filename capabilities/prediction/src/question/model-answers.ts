import { Effect, Option } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { executingRuntimeOf, readsTheCalendar } from '../runtimes/model-runtimes.ts';
import type { AnsweringModel } from './default-forecast.ts';
import { busy, crashedAs, ended, noRuntimeAs, notFinite } from './model-refusals.ts';
import { askedOf, givenOf, predictedOf, type Question } from './question-asked.ts';
import type { SeriesWindow } from './series-window.ts';

export interface Answering {
  readonly ports: PredictionPorts;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly question: Question;
}

function noRuntimeFor({ version, format }: AnsweringModel) {
  const model = version === null ? 'the default forecast' : `version ${version}`;
  return noRuntimeAs(
    `No model runtime this server has installed executes the format ${format} of ${model}; install the extension that executes it, or ask for a build`,
  );
}

export function answered({ ports, document, question }: Answering, model: AnsweringModel, window: SeriesWindow) {
  return Effect.gen(function* () {
    const executing = executingRuntimeOf(ports.runtimes, { sha256: model.file, format: model.format });
    if (executing === undefined) {
      return yield* Effect.fail(noRuntimeFor(model));
    }
    const asked = askedOf(document.predicts, window.origin, question);
    const kept = yield* ports.caches.models.pathOf(executing.file, model.source);
    const path = Option.getOrThrow(Option.fromNullishOr(kept));
    const outcome = yield* ports.models.run(
      executing.runtime,
      { sha256: model.file, path },
      {
        y: Float32Array.from(window.y),
        x: window.x,
        given: givenOf(document, question, asked.steps),
        h: asked.summed,
        at: readsTheCalendar(executing.runtime) ? window.origin : null,
        features: document.data.features.length,
        givens: document.data.given.length,
      },
    );
    if (outcome.ended === 'busy') {
      return yield* Effect.fail(busy);
    }
    if (outcome.ended === 'crashed') {
      return yield* Effect.fail(crashedAs(outcome.detail));
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
