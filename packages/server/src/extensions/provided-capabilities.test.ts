import { defineCapability } from '@on.auto/definitions';
import { RunContextSchema, earlierShapeOf, factOf, readingEarlierShapes } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { AFactOfAnyTypeSchema, ForecastNotedSchema, forecastChecked } from '../testing/extensions/declared-facts.ts';
import { providedCapabilityOf } from './provided-capabilities.ts';

const forecasts = defineCapability({
  type: 'prediction',
  title: 'Forecasts',
  guide: { name: 'prediction-function' },
  noun: { one: 'prediction function', other: 'prediction functions' },
  describeOutput: () => 'The extension answered.',
  mediaType: 'text/markdown',
  parse: (source) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.succeed({ output: null, record: {} }),
});

function declaringOnRuns(...onRuns: readonly unknown[]): unknown {
  return { capability: { ...forecasts, facts: { onRuns, streams: [] } } };
}

function declaringTheGuide(guide: unknown): unknown {
  return { capability: { ...forecasts, guide } };
}

const ForecastCheckedBefore = factOf('forecast_checked', Schema.Struct({ verdict: Schema.String }), RunContextSchema);

const readingTheShapeBefore = readingEarlierShapes(
  factOf('forecast_checked', Schema.Struct({ checked: Schema.Boolean }), RunContextSchema),
  [
    earlierShapeOf(ForecastCheckedBefore, ({ data, ...fact }) => ({
      ...fact,
      data: { checked: data.verdict === 'checked' },
    })),
  ],
);

describe('the facts on runs of a capability an extension provides', () => {
  it('are taken where each is a fact of the one type its schema reads', () => {
    const provided = providedCapabilityOf(declaringOnRuns(forecastChecked));

    expect(Result.map(provided, ({ capability }) => capability.facts.onRuns)).toEqual(
      Result.succeed([forecastChecked]),
    );
  });

  it('are taken where a schema reads earlier shapes of its own fact, so an extension ships the reader of a shape before', () => {
    const readingBefore = { ...forecastChecked, schema: readingTheShapeBefore };

    const provided = providedCapabilityOf(declaringOnRuns(readingBefore));

    expect(Result.map(provided, ({ capability }) => capability.facts.onRuns)).toEqual(Result.succeed([readingBefore]));
  });
});

describe('the facts on runs of a capability an extension provides, refused', () => {
  it.each<readonly [string, readonly unknown[], string]>([
    [
      'has no schema',
      [{ type: 'forecast_checked', present: forecastChecked.present }],
      'its capability.facts.onRuns[0] has no schema',
    ],
    [
      'has a schema that is none',
      [{ ...forecastChecked, schema: { type: 'forecast_checked' } }],
      'its capability.facts.onRuns[0].schema is not a schema',
    ],
    [
      'has the schema of a fact of another type',
      [{ ...forecastChecked, schema: ForecastNotedSchema }],
      'its capability.facts.onRuns[0] declares the fact forecast_checked with a schema that does not read facts of the type forecast_checked alone',
    ],
    [
      'has a schema that reads facts of its type and of another',
      [{ ...forecastChecked, schema: Schema.Union([forecastChecked.schema, ForecastNotedSchema]) }],
      'its capability.facts.onRuns[0] declares the fact forecast_checked with a schema that does not read facts of the type forecast_checked alone',
    ],
    [
      'declares a type the runtime reads as a fact of its own',
      [
        {
          ...forecastChecked,
          type: 'connection_added',
          schema: factOf('connection_added', Schema.Struct({}), RunContextSchema),
        },
      ],
      'its capability.facts.onRuns[0] declares the fact connection_added, a type the runtime reads as a fact of its own',
    ],
    [
      'has a schema of facts of any type',
      [forecastChecked, { ...forecastChecked, type: 'forecast_noted', schema: AFactOfAnyTypeSchema }],
      'its capability.facts.onRuns[1] declares the fact forecast_noted with a schema that does not read facts of the type forecast_noted alone',
    ],
  ])('name the fact, where one %s', (_case, onRuns, refusal) => {
    expect(providedCapabilityOf(declaringOnRuns(...onRuns))).toEqual(Result.fail(refusal));
  });
});

describe('the content a fact on runs of a capability an extension provides holds, refused', () => {
  it('names the fact, where it declares what it holds by a pointer that does not begin at the root of the fact', () => {
    const misdeclared = factOf('forecast_checked', Schema.Struct({ checked: Schema.Boolean }), RunContextSchema);

    const provided = providedCapabilityOf(
      declaringOnRuns({ ...forecastChecked, schema: misdeclared.annotate({ heldContent: { holds: ['sha256'] } }) }),
    );

    expect(provided).toEqual(
      Result.fail(
        'its capability.facts.onRuns[0] declares the fact forecast_checked with a declaration of the content it holds or releases that the runtime does not read',
      ),
    );
  });
});

describe('the guide of a capability an extension provides', () => {
  it('may give, for each value its pages name, the words in force on this server and the default the pages write', () => {
    const guide = {
      name: 'prediction-function',
      variables: { 'prediction.longest_history': { value: '90 days', default: '365 days' } },
    };

    expect(Result.map(providedCapabilityOf(declaringTheGuide(guide)), ({ capability }) => capability.guide)).toEqual(
      Result.succeed(guide),
    );
  });

  it.each<readonly [string, unknown, string]>([
    ['not a record', ['90 days'], 'its capability.guide.variables is not a record'],
    [
      'a value without its default',
      { 'prediction.longest_history': { value: '90 days' } },
      'its capability.guide.variables.prediction.longest_history has no default',
    ],
  ])('is refused where its variables are %s, naming the place', (_case, variables, refusal) => {
    expect(providedCapabilityOf(declaringTheGuide({ name: 'prediction-function', variables }))).toEqual(
      Result.fail(refusal),
    );
  });
});
