import { Result, Schema } from 'effect';

import { newRun, RunStateSchema, type RunState } from '../machine/run-state.ts';
import { RunLogEventSchema, type RunLogEvent } from '../run-log/run-event.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import { EventOfFormatElevenSchema } from './format-eleven-events.ts';
import { StateOfFormatElevenSchema } from './format-eleven-state.ts';

const writeEvent = Schema.encodeSync(Schema.toCodecJson(RunLogEventSchema));

const writeState = Schema.encodeSync(Schema.toCodecJson(RunStateSchema));

const readEvent = Schema.decodeUnknownResult(EventOfFormatElevenSchema, { onExcessProperty: 'error' });

const readState = Schema.decodeUnknownResult(StateOfFormatElevenSchema, { onExcessProperty: 'error' });

function statesAfter(events: readonly RunLogEvent[]): readonly RunState[] {
  const states: RunState[] = [];
  for (const event of events) {
    states.push(evolveRun(states.at(-1) ?? newRun, event));
  }
  return states;
}

function eventRefused(event: RunLogEvent, place: string): readonly string[] {
  const read = readEvent(writeEvent(event));
  return Result.isFailure(read) ? [`${place}: ${String(read.failure)}`] : [];
}

function stateRefused(state: RunState, place: string): readonly string[] {
  const read = readState(writeState(state));
  return Result.isFailure(read) ? [`${place}: ${String(read.failure)}`] : [];
}

export function formatElevenRefusalsOf(events: readonly RunLogEvent[]): readonly string[] {
  const states = statesAfter(events);
  return events.flatMap((event, index) =>
    eventRefused(event, `event ${index + 1}`).concat(
      states.slice(index, index + 1).flatMap((state) => stateRefused(state, `state after event ${index + 1}`)),
    ),
  );
}
