import { Data, type Effect, type Schema } from 'effect';

import type { PositionedEvent } from '../run-log/run-event.ts';
import type { RunOutput } from './run-output.ts';

export interface DispatchWatermark {
  readonly read: (runId: string) => Effect.Effect<number>;
  readonly advance: (runId: string, through: number) => Effect.Effect<void>;
  readonly behindRuns: (limit: number) => Effect.Effect<readonly string[]>;
}

export interface RunContext {
  readonly runId: string;
  readonly attributes: Schema.JsonObject;
}

export interface OutputOrigin {
  readonly version: number;
}

export interface PositionedOutput {
  readonly version: number;
  readonly output: RunOutput;
}

export class DispatchFailed extends Data.TaggedError('dispatch_failed')<{
  readonly output: RunOutput['kind'] | 'note_due';
  readonly detail: string;
}> {}

function inStreamOrder(events: readonly PositionedEvent[]): readonly PositionedEvent[] {
  return events.toSorted((first, second) => first.version - second.version);
}

export function outputsAbove(watermark: number, events: readonly PositionedEvent[]): readonly PositionedOutput[] {
  return inStreamOrder(events)
    .filter(({ version }) => version > watermark)
    .flatMap(({ version, event }) => event.outputs.map((output) => ({ version, output })));
}

export function dispatchedThrough(watermark: number, events: readonly PositionedEvent[], firstFailed?: number): number {
  const last = Math.max(watermark, ...events.map(({ version }) => version));
  return firstFailed === undefined ? last : Math.max(watermark, firstFailed - 1);
}
