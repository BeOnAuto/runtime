import { outputPayloadOf } from '@on.auto/operations/payloads';
import type { Schema } from 'effect';

import type { RunResult } from './run-commands.ts';
import type { RecordedRunFact } from './run-events.ts';
import type { RunRecord } from './run.ts';

export type RecordedFinish = RecordedRunFact<'run_succeeded' | 'run_rejected' | 'run_failed'>;

export function resultOf(event: RecordedFinish): RunResult {
  if (event.type === 'run_rejected') {
    return { type: event.type, data: { rejection: event.data.rejection } };
  }
  if (event.type === 'run_succeeded') {
    return { type: event.type, data: event.data };
  }
  return { type: event.type, data: event.data };
}

export function finishedRecord(
  { type, name, definition_version, output_shape, started_at, started_by, acts_for }: RunRecord,
  result: RunResult,
  at: string,
): RunRecord {
  const attempt = {
    type,
    name,
    definition_version,
    ...(output_shape === undefined ? {} : { output_shape }),
    started_at,
    started_by,
    ...(acts_for === undefined ? {} : { acts_for }),
    finished_at: at,
  };
  if (result.type === 'run_succeeded') {
    const { incomplete_details: incomplete } = result.data;
    return {
      ...attempt,
      status: 'succeeded',
      output: outputPayloadOf(result),
      ...(incomplete === undefined ? {} : { incomplete_details: incomplete }),
    };
  }
  if (result.type === 'run_rejected') {
    return { ...attempt, status: 'rejected', rejection: result.data.rejection };
  }
  return { ...attempt, status: 'failed' };
}

export function recordOf(event: RecordedFinish): Schema.JsonObject | undefined {
  return event.type === 'run_failed' ? undefined : event.data.record;
}
