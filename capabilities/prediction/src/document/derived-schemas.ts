import { Buffer } from 'node:buffer';

import { seriesMarksSchema } from '@on.auto/definitions';
import { compileJsonSchema, type CompiledSchema, type FurtherCheck } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { isMapping } from './checked-parts.ts';
import type { DataPart, DerivedSchemas, Predicts } from './prediction-document.ts';

const { mostSeriesBytes } = predictionBounds;

function givenSchema(given: readonly string[], { accumulates }: Predicts): Schema.JsonObject {
  const periods = accumulates === undefined ? 'the periods ahead' : 'the periods summed';
  return {
    type: 'object',
    description: `The value of each given feature for ${periods}, by its name`,
    required: [...given],
    additionalProperties: false,
    properties: Object.fromEntries(given.map((name) => [name, { type: 'number' }])),
  };
}

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

function questionSchema(predicts: Predicts, { given }: Pick<DataPart, 'given'>): Schema.JsonObject {
  return {
    type: 'object',
    title: 'question',
    description: questionWords(predicts),
    required: given.length === 0 ? ['series'] : ['series', 'given'],
    additionalProperties: false,
    properties: {
      series: {
        type: 'string',
        minLength: 1,
        maxLength: mostSeriesBytes,
        description: `The series, text of 1 to ${mostSeriesBytes} bytes in UTF-8`,
      },
      ...horizonOf(predicts),
      ...(given.length === 0 ? {} : { given: givenSchema(given, predicts) }),
      marks: { ...seriesMarksSchema, description: 'Values the answer carries as its marks, for display alone' },
    },
  };
}

const buildInputSchema: Schema.JsonObject = {
  type: 'object',
  title: 'build',
  description: 'A build: asks a trainer for candidate models, scores them and keeps the winner as a version',
  required: ['build'],
  additionalProperties: false,
  properties: { build: { type: 'object', additionalProperties: false, properties: {} } },
};

const seriesBytes: FurtherCheck = (input) => {
  const series = isMapping(input) ? input['series'] : undefined;
  const bytes = typeof series === 'string' ? Buffer.byteLength(series, 'utf8') : 0;
  return bytes > mostSeriesBytes
    ? [{ pointer: '/series', detail: `Expected at most ${mostSeriesBytes} bytes in UTF-8, not ${bytes}` }]
    : [];
};

function compiled(document: Schema.JsonObject, further?: FurtherCheck): CompiledSchema {
  return Result.getOrThrow(
    compileJsonSchema(document, { what: 'input', nesting: 16, ...(further === undefined ? {} : { further }) }),
  );
}

const buildInput = compiled(buildInputSchema);

export function derivedSchemasOf(predicts: Predicts, data: Pick<DataPart, 'given'>): DerivedSchemas {
  const question = questionSchema(predicts, data);
  return {
    input: { oneOf: [question, buildInputSchema] },
    question: compiled(question, seriesBytes),
    build: buildInput,
  };
}
