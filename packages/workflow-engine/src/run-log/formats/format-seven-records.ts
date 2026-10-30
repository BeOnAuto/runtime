import type { RejectionBecause, Settlement, UnavailableKind } from '@on.auto/operations';
import { Schema } from 'effect';

import type { RunOutput } from '../../dispatch/run-output.ts';
import type { InputReceipt } from '../../machine/input-receipt.ts';
import {
  CallKeySchema,
  currentWordOf,
  inWrittenWords,
  isNotATestRefusal,
  receiptInWords,
  withoutAWordInFormatEight,
  writtenWordOf,
} from './format-seven.ts';
import {
  EarlierStepSchema,
  IssueSchema,
  PatchOperationSchema,
  ReceiptSchema,
  ResumedSchema,
  StepSchema,
} from './format-six-records.ts';
import { InstantSchema, TimerPurposeSchema } from './format-two.ts';

const UnavailableKindSchema = Schema.Literals([
  'model_not_offered',
  'tool_not_offered',
  'mcp_server_failed',
  'tools_unfinished',
  'rebuilding',
  'requests_full',
  'builds_full',
  'dataset_not_ready',
  'model_process_busy',
  'model_process_failed',
]);

const RejectionBecauseSchema = Schema.Literals([
  'provider_not_configured',
  'model_not_allowed',
  'mcp_server_not_configured',
  'tool_not_allowed',
  'tool_not_listed',
  'not_testable',
  'failing',
  'rate_limited',
  'unreachable',
  'key_refused',
  'server_failed',
  'tool_error',
  'model_unavailable',
  'run_bound',
  'no_answer',
  'only_read',
  'builds_of_the_day',
  'stalled',
  'not_finite',
]);

const BecauseOfFormatEightSchema = RejectionBecauseSchema.pipe(
  Schema.refine(isNotATestRefusal, withoutAWordInFormatEight),
);

const ConflictKindSchema = Schema.Literals([
  'taken',
  'retired',
  'concurrent_change',
  'unworkable',
  'stalled',
  'tools_called',
  'effect_unknown',
  'oversized',
  'no_active_version',
  'data_changed',
  'build_in_flight',
  'dataset_too_large',
  'not_a_build',
  'build_ended',
  'already_active',
]);

const settledBy = { by: Schema.optionalKey(Schema.NonEmptyString) };

const recorded = { record: Schema.optionalKey(Schema.JsonObject), ...settledBy };

const rejected = { status: Schema.Literal('rejected'), detail: Schema.String, ...recorded };

const SettlementSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json, ...recorded }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('invalid_input'),
    issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('unavailable'),
    kind: Schema.optionalKey(UnavailableKindSchema),
    because: Schema.optionalKey(BecauseOfFormatEightSchema),
  }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('conflict'),
    kind: Schema.optionalKey(ConflictKindSchema),
    because: Schema.optionalKey(BecauseOfFormatEightSchema),
  }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('cancelled'),
    kind: Schema.Literals(['requested', 'deadline', 'overrun', 'parent_ended']),
  }),
  Schema.Struct({
    ...rejected,
    reason: Schema.Literal('unanswered'),
    kind: Schema.Literals(['expired', 'undelivered']),
  }),
  Schema.Struct({ status: Schema.Literal('failed'), incident: Schema.optionalKey(Schema.String), ...settledBy }),
]);

const RunIdSchema = Schema.NonEmptyString;

const OutputSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('arm_timer'),
    runId: RunIdSchema,
    timerId: Schema.NonEmptyString,
    dueAt: InstantSchema,
    purpose: TimerPurposeSchema,
    label: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal('cancel_timer'), runId: RunIdSchema, timerId: Schema.NonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal('start_call'),
    key: CallKeySchema,
    function: Schema.NonEmptyString,
    arguments: Schema.Json,
    longestMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal('cancel_call'),
    key: CallKeySchema,
    reason: Schema.optionalKey(Schema.Literals(['deadline', 'parent_ended'])),
  }),
  Schema.Struct({ kind: Schema.Literal('arm_listener'), key: CallKeySchema, filters: Schema.Array(Schema.JsonObject) }),
  Schema.Struct({ kind: Schema.Literal('cancel_listener'), key: CallKeySchema }),
  Schema.Struct({ kind: Schema.Literal('emit_event'), key: CallKeySchema, event: Schema.JsonObject }),
  Schema.Struct({ kind: Schema.Literal('settle'), runId: RunIdSchema, settlement: SettlementSchema }),
]);

export const EventOfFormatSevenSchema = Schema.Struct({
  type: Schema.Literal('input_applied'),
  format: Schema.Literal(7),
  receipt: ReceiptSchema,
  steps: Schema.Array(Schema.Union([StepSchema, EarlierStepSchema])),
  resumed: Schema.optionalKey(Schema.NullOr(ResumedSchema)),
  patch: Schema.Array(PatchOperationSchema),
  outputs: Schema.Array(OutputSchema),
});

type EventOfFormatSeven = typeof EventOfFormatSevenSchema.Type;

type OutputOfFormatSeven = typeof OutputSchema.Type;

type SettlementOfFormatSeven = typeof SettlementSchema.Type;

function kindNow(kind: typeof UnavailableKindSchema.Type): UnavailableKind {
  return kind === 'mcp_server_failed' ? 'tool_server_failed' : kind;
}

function becauseNow(because: typeof BecauseOfFormatEightSchema.Type): RejectionBecause {
  return because === 'mcp_server_not_configured' ? 'tool_server_not_configured' : because;
}

function becauseOf(because: typeof BecauseOfFormatEightSchema.Type | undefined) {
  return because === undefined ? {} : { because: becauseNow(because) };
}

function settlementNow(settlement: SettlementOfFormatSeven): Settlement {
  if (settlement.status !== 'rejected') {
    return settlement;
  }
  if (settlement.reason === 'unavailable') {
    const { kind, because, ...unavailable } = settlement;
    return { ...unavailable, ...(kind === undefined ? {} : { kind: kindNow(kind) }), ...becauseOf(because) };
  }
  if (settlement.reason === 'conflict') {
    const { because, ...conflict } = settlement;
    return { ...conflict, ...becauseOf(because) };
  }
  return settlement;
}

function outputNow(output: OutputOfFormatSeven): RunOutput {
  return output.kind === 'settle' ? { ...output, settlement: settlementNow(output.settlement) } : output;
}

function eventNow({ receipt, outputs, ...event }: EventOfFormatSeven) {
  return {
    ...event,
    receipt: receiptInWords(receipt, currentWordOf),
    outputs: outputs.map((output) => outputNow(output)),
  };
}

function outputThen(output: RunOutput): unknown {
  return output.kind === 'settle' ? { ...output, settlement: inWrittenWords(output.settlement) } : output;
}

interface EventNow {
  readonly receipt: InputReceipt;
  readonly outputs: readonly RunOutput[];
}

function eventThen({ receipt, outputs, ...event }: EventNow): unknown {
  return {
    ...event,
    receipt: receiptInWords(receipt, writtenWordOf),
    outputs: outputs.map((output) => outputThen(output)),
  };
}

export const eventNamesOfFormatSeven = { current: eventNow, written: eventThen };

export const SnapshotOfFormatSevenSchema = Schema.Struct({
  format: Schema.Literal(7),
  runId: Schema.NonEmptyString,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  historyBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  state: Schema.Json,
});

function snapshotAsWritten<Snapshot>(snapshot: Snapshot): Snapshot {
  return snapshot;
}

export const snapshotNamesOfFormatSeven = { current: snapshotAsWritten, written: snapshotAsWritten };
