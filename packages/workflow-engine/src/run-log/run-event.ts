import { PayloadBytesSchema, PayloadDigestSchema } from '@on.auto/operations/payloads';
import { Schema } from 'effect';

import { OutputHeldInlineSchema, RunOutputSchema } from '../dispatch/run-output.ts';
import { InputReceiptSchema } from '../machine/input-receipt.ts';
import { EarlierStepSchema, ResumedSchema, StepSchema } from '../steps/step-entry.ts';
import { EventOfFormatSevenSchema, eventNamesOfFormatSeven } from './formats/format-seven-records.ts';
import {
  EventOfFormatsOneToSixSchema,
  eventNamesOfFormatsOneToSix,
  FormatsOneToSixSchema,
} from './formats/format-six-records.ts';
import {
  FormatsEightToElevenSchema,
  stateFormat,
  ThisFormatOrNewerSchema,
  writtenInAnOlderFormat,
} from './state-format.ts';
import { PatchOperationSchema } from './state-patch.ts';

const KeptPayloadSchema = Schema.Struct({ sha256: PayloadDigestSchema, bytes: PayloadBytesSchema });

const KeptPayloadsSchema = Schema.Array(KeptPayloadSchema).check(
  Schema.makeFilter(
    (kept: readonly (typeof KeptPayloadSchema.Type)[]) =>
      new Set(kept.map(({ sha256 }) => sha256)).size === kept.length,
    { expected: 'each payload the event names, once' },
  ),
);

function eventInFormat<Format extends Schema.Top, Output extends Schema.Top>(format: Format, output: Output) {
  return Schema.Struct({
    type: Schema.Literal('input_applied'),
    format,
    receipt: InputReceiptSchema,
    steps: Schema.Array(Schema.Union([StepSchema, EarlierStepSchema])),
    resumed: Schema.optionalKey(Schema.NullOr(ResumedSchema)),
    patch: Schema.Array(PatchOperationSchema),
    outputs: Schema.Array(output),
  });
}

const EventKeepingPayloadsSchema = Schema.Struct({
  ...eventInFormat(ThisFormatOrNewerSchema, RunOutputSchema).fields,
  kept: KeptPayloadsSchema,
});

export const RunLogEventSchema = Schema.Union([
  eventInFormat(FormatsEightToElevenSchema, OutputHeldInlineSchema),
  EventKeepingPayloadsSchema,
  writtenInAnOlderFormat(
    EventOfFormatsOneToSixSchema,
    eventInFormat(FormatsOneToSixSchema, OutputHeldInlineSchema),
    eventNamesOfFormatsOneToSix,
  ),
  writtenInAnOlderFormat(
    EventOfFormatSevenSchema,
    eventInFormat(Schema.Literal(7), OutputHeldInlineSchema),
    eventNamesOfFormatSeven,
  ),
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

function startedBytesOf(event: RunLogEvent): number {
  return event.outputs.reduce(
    (sum, output) => sum + (output.kind === 'start_call' ? (output.arguments_bytes ?? 0) : 0),
    0,
  );
}

function keptBytesOf(event: RunLogEvent): number {
  const held = 'kept' in event ? event.kept.reduce((sum, { bytes }) => sum + bytes, 0) : 0;
  return held + startedBytesOf(event);
}

export function eventBytesOf(event: RunLogEvent): number {
  return utf8.encode(JSON.stringify(asWritten(event))).byteLength + keptBytesOf(event);
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
