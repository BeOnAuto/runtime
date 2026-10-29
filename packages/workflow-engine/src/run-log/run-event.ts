import { Schema } from 'effect';

import { RunOutputSchema } from '../dispatch/run-output.ts';
import { InputReceiptSchema } from '../machine/input-receipt.ts';
import { mostEventBytes } from '../machine/limits.ts';
import { EarlierStepSchema, ResumedSchema, StepSchema } from '../steps/step-entry.ts';
import { EventOfFormatSevenSchema, eventNamesOfFormatSeven } from './formats/format-seven-records.ts';
import {
  EventOfFormatsOneToSixSchema,
  eventNamesOfFormatsOneToSix,
  FormatsOneToSixSchema,
} from './formats/format-six-records.ts';
import { stateFormat, ThisFormatOrNewerSchema, writtenInAnOlderFormat } from './state-format.ts';
import { PatchOperationSchema } from './state-patch.ts';

function eventInFormat<Format extends Schema.Top>(format: Format) {
  return Schema.Struct({
    type: Schema.Literal('input_applied'),
    format,
    receipt: InputReceiptSchema,
    steps: Schema.Array(Schema.Union([StepSchema, EarlierStepSchema])),
    resumed: Schema.optionalKey(Schema.NullOr(ResumedSchema)),
    patch: Schema.Array(PatchOperationSchema),
    outputs: Schema.Array(RunOutputSchema),
  });
}

export const RunLogEventSchema = Schema.Union([
  eventInFormat(ThisFormatOrNewerSchema),
  writtenInAnOlderFormat(
    EventOfFormatsOneToSixSchema,
    eventInFormat(FormatsOneToSixSchema),
    eventNamesOfFormatsOneToSix,
  ),
  writtenInAnOlderFormat(EventOfFormatSevenSchema, eventInFormat(Schema.Literal(7)), eventNamesOfFormatSeven),
  eventInFormat(Schema.Literals([8, 9])),
]);

export type RunLogEvent = typeof RunLogEventSchema.Type;

export interface PositionedEvent {
  readonly version: number;
  readonly event: RunLogEvent;
}

const utf8 = new TextEncoder();

const writeEvent = Schema.encodeSync(RunLogEventSchema);

function asWritten(event: RunLogEvent): unknown {
  return event.format < stateFormat ? writeEvent(event) : event;
}

export function eventBytesOf(event: RunLogEvent): number {
  return utf8.encode(JSON.stringify(asWritten(event))).byteLength;
}

export function fitsInOneEvent(event: RunLogEvent): boolean {
  return eventBytesOf(event) <= mostEventBytes;
}

function withHistoryBytesOf(event: RunLogEvent, historyBytes: number): RunLogEvent {
  return { ...event, patch: [...event.patch, { op: 'replace', path: '/historyBytes', value: historyBytes }] };
}

export function withHistoryBytes(event: RunLogEvent, before: number): RunLogEvent {
  const settled = (guess: number): RunLogEvent => {
    const counted = withHistoryBytesOf(event, before + guess);
    const bytes = eventBytesOf(counted);
    return bytes === guess ? counted : settled(bytes);
  };
  return settled(0);
}
