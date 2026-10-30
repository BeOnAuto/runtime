import {
  RunOutcomeStatusSchema,
  type ProjectedRow,
  type RunOutcome,
  type RunOutcomeMapping,
  type KeyedProjection,
} from '@on.auto/operations';
import { Schema } from 'effect';

const runOutcomesVersion = 4;

export const runOutcomesTable = `run_outcomes_${runOutcomesVersion}`;

const KeptOutcomeSchema = Schema.Struct({
  started_day: Schema.String,
  started_at: Schema.String,
  last_started_at: Schema.String,
  definition_type: Schema.String,
  name: Schema.String,
  status: RunOutcomeStatusSchema,
  duration_ms: Schema.NullOr(Schema.Number),
  input_tokens: Schema.NullOr(Schema.Number),
  output_tokens: Schema.NullOr(Schema.Number),
  cached_tokens: Schema.NullOr(Schema.Number),
});

const decodeKept = Schema.decodeUnknownSync(KeptOutcomeSchema);

function outcomeOf(row: ProjectedRow): RunOutcome {
  const kept = decodeKept(row);
  return {
    startedDay: kept.started_day,
    startedAt: kept.started_at,
    lastStartedAt: kept.last_started_at,
    definitionType: kept.definition_type,
    name: kept.name,
    status: kept.status,
    durationMs: kept.duration_ms,
    inputTokens: kept.input_tokens,
    outputTokens: kept.output_tokens,
    cachedTokens: kept.cached_tokens,
  };
}

function rowOf(outcome: RunOutcome): ProjectedRow {
  return {
    started_day: outcome.startedDay,
    started_at: outcome.startedAt,
    last_started_at: outcome.lastStartedAt,
    definition_type: outcome.definitionType,
    name: outcome.name,
    status: outcome.status,
    duration_ms: outcome.durationMs,
    input_tokens: outcome.inputTokens,
    output_tokens: outcome.outputTokens,
    cached_tokens: outcome.cachedTokens,
  };
}

function runOutcomeProjectionOf({ types, rowAfter }: RunOutcomeMapping): KeyedProjection {
  return {
    name: 'run_outcomes',
    version: runOutcomesVersion,
    kinds: ['runs'],
    types,
    columns: [
      { name: 'started_day', kind: 'text' },
      { name: 'started_at', kind: 'text' },
      { name: 'last_started_at', kind: 'text' },
      { name: 'definition_type', kind: 'text' },
      { name: 'name', kind: 'text' },
      { name: 'status', kind: 'text' },
      { name: 'duration_ms', kind: 'integer' },
      { name: 'input_tokens', kind: 'integer' },
      { name: 'output_tokens', kind: 'integer' },
      { name: 'cached_tokens', kind: 'integer' },
    ],
    indexes: [{ name: 'by_playbook_and_day', columns: ['started_day'] }],
    rowAfter: (row, message) => {
      const outcome = rowAfter(row === undefined ? undefined : outcomeOf(row), message);
      return outcome === undefined ? undefined : rowOf(outcome);
    },
  };
}

export function keptProjections(
  runOutcomes: RunOutcomeMapping | undefined,
  projections: readonly KeyedProjection[],
): readonly KeyedProjection[] {
  return [...(runOutcomes === undefined ? [] : [runOutcomeProjectionOf(runOutcomes)]), ...projections];
}
