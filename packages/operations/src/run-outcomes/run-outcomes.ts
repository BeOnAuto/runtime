import { Schema } from 'effect';

import { addressedStreamOf, type ProjectedMessage } from '../projections/keyed-projection.ts';

export const RunOutcomeStatusSchema = Schema.Literals(['started', 'succeeded', 'failed', 'rejected']);

export type RunOutcomeStatus = typeof RunOutcomeStatusSchema.Type;

export interface RunOutcome {
  readonly startedDay: string;
  readonly startedAt: string;
  readonly lastStartedAt: string;
  readonly definitionType: string;
  readonly name: string;
  readonly status: RunOutcomeStatus;
  readonly durationMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly costMicroUsd: number | null;
}

export interface RunOutcomeMapping {
  readonly types: readonly string[];
  readonly rowAfter: (row: RunOutcome | undefined, message: ProjectedMessage) => RunOutcome | undefined;
}

export interface RunOutcomeWindow {
  readonly from: string;
  readonly to: string;
}

export interface RunOutcomeSelection {
  readonly definitionType?: string;
  readonly name?: string;
}

export interface RunOutcomeGroup {
  readonly day: string;
  readonly definitionType: string;
  readonly name: string;
  readonly status: RunOutcomeStatus;
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly costMicroUsd: number | null;
  readonly durations: readonly number[];
}

export interface RunStream {
  readonly definitionKey: string;
  readonly runId: string;
}

export function runStreamOf(stream: string): RunStream | undefined {
  const addressed = addressedStreamOf(stream);
  return addressed?.scope === 'definition' && addressed.kind === 'runs'
    ? { definitionKey: addressed.prefix, runId: addressed.id }
    : undefined;
}
