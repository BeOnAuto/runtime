import { Buffer } from 'node:buffer';

import { seriesMarksSchema } from '@on.auto/definitions';
import { compileJsonSchema, type FurtherCheck } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { isMapping } from './checked-parts.ts';
import type { DerivedSchemas, Predicts } from './prediction-document.ts';

const { mostSeriesBytes } = predictionBounds;

function horizonOf({ horizons, accumulates }: Predicts): { readonly horizon?: Schema.JsonObject } {
  return accumulates === undefined
    ? {
        horizon: {
          type: 'integer',
          enum: [...horizons],
          description: 'How many periods ahead of the last observed to predict; every horizon when left out',
        },
      }
    : {};
}

function questionWords({ target, unit, period, accumulates }: Predicts): string {
  return accumulates === undefined
    ? `A question: the series to predict its ${target} for, in ${unit}, at one horizon or at every horizon`
    : `A question: the series to predict the total of its ${target} for, in ${unit}, from the ${period} after its last observed one to the end of that ${accumulates}`;
}

function questionSchema(predicts: Predicts): Schema.JsonObject {
  return {
    type: 'object',
    title: 'question',
    description: questionWords(predicts),
    required: ['series'],
    additionalProperties: false,
    properties: {
      series: {
        type: 'string',
        minLength: 1,
        maxLength: mostSeriesBytes,
        description: `The series, text of 1 to ${mostSeriesBytes} bytes in UTF-8`,
      },
      ...horizonOf(predicts),
      marks: { ...seriesMarksSchema, description: 'Values the answer carries as its marks, for display alone' },
    },
  };
}

const seriesBytes: FurtherCheck = (input) => {
  const series = isMapping(input) ? input['series'] : undefined;
  const bytes = typeof series === 'string' ? Buffer.byteLength(series, 'utf8') : 0;
  return bytes > mostSeriesBytes
    ? [{ pointer: '/series', detail: `Expected at most ${mostSeriesBytes} bytes in UTF-8, not ${bytes}` }]
    : [];
};

export function derivedSchemasOf(predicts: Predicts): DerivedSchemas {
  const question = questionSchema(predicts);
  return {
    input: question,
    question: Result.getOrThrow(compileJsonSchema(question, { what: 'input', nesting: 16, further: seriesBytes })),
  };
}
