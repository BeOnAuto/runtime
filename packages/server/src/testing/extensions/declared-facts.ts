import { declaredFact } from '@on.auto/definitions';
import { RunContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';

const ForecastCheckedSchema = factOf('forecast_checked', Schema.Struct({ checked: Schema.Boolean }), RunContextSchema);

export const forecastChecked = declaredFact('forecast_checked', ForecastCheckedSchema, ({ type, data }) => ({
  type,
  summary: 'Checked.',
  data,
}));

export const ForecastNotedSchema = factOf('forecast_noted', Schema.Struct({}), RunContextSchema);

export const AFactOfAnyTypeSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({}),
  context: RunContextSchema,
});
