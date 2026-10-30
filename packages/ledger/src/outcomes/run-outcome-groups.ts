import { RunOutcomeStatusSchema, type RunOutcomeGroup } from '@on.auto/operations';
import { Schema } from 'effect';

export const groupFields = {
  day: Schema.String,
  definition_type: Schema.String,
  name: Schema.String,
  status: RunOutcomeStatusSchema,
  runs: Schema.Number,
  input_tokens: Schema.Number,
  output_tokens: Schema.Number,
  cached_tokens: Schema.Number,
};

export interface GroupRow {
  readonly day: string;
  readonly definition_type: string;
  readonly name: string;
  readonly status: RunOutcomeGroup['status'];
  readonly runs: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cached_tokens: number;
  readonly durations: readonly number[];
}

export function groupOf(row: GroupRow): RunOutcomeGroup {
  return {
    day: row.day,
    definitionType: row.definition_type,
    name: row.name,
    status: row.status,
    runs: row.runs,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedTokens: row.cached_tokens,
    durations: row.durations,
  };
}
