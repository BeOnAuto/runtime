import { runChanged, runChangedBy } from '@on.auto/definitions';
import { changingOne, type Presenter } from '@on.auto/operations';
import {
  RunLogEventSchema,
  type EarlierStep,
  type InputReceipt,
  type RunLogEvent,
  type Step,
} from '@on.auto/workflow-engine';
import { Schema } from 'effect';

import { cutAtCodePoint } from './cut-text.ts';
import { summaryOf } from './run-words.ts';
import { stepFactsOf, stepEventTypes } from './step-events.ts';

const mostStepsShown = 5;

const mostKeyBytes = 256;

const mostReferenceBytes = 256;

const runLogsKind = 'run-logs';

const decodeRunLogEvent = Schema.decodeUnknownSync(Schema.toCodecJson(RunLogEventSchema));

type Rejection = NonNullable<Extract<InputReceipt, { readonly kind: 'call_answered' }>['rejection']>;

function rejectionShown({ kind, because }: Rejection): Schema.JsonObject {
  return {
    ...(kind === undefined ? {} : { kind: cutAtCodePoint(kind, mostKeyBytes) }),
    ...(because === undefined ? {} : { because: cutAtCodePoint(because, mostKeyBytes) }),
  };
}

function inputShown(receipt: InputReceipt, runId: string): Schema.JsonObject {
  if (receipt.kind === 'call_answered') {
    const { rejection } = receipt;
    return {
      kind: receipt.kind,
      key: cutAtCodePoint(receipt.key, mostKeyBytes),
      status: receipt.status,
      ...(rejection === undefined ? {} : { rejection: rejectionShown(rejection) }),
    };
  }
  if (receipt.kind === 'event_received') {
    return {
      kind: receipt.kind,
      key: cutAtCodePoint(receipt.key, mostKeyBytes),
      event_type: cutAtCodePoint(receipt.eventType, mostKeyBytes),
    };
  }
  if (receipt.kind === 'cancel_requested' && receipt.cancel !== undefined) {
    const { by, kind } = receipt.cancel;
    return { kind: receipt.kind, key: runId, cancel: { by: cutAtCodePoint(by, mostKeyBytes), kind } };
  }
  return { kind: receipt.kind, key: receipt.kind === 'timer_fired' ? receipt.key : runId };
}

function stepShown({ reference, run, outcome }: Step | EarlierStep): Schema.JsonObject {
  return { task: cutAtCodePoint(reference, mostReferenceBytes), run, outcome };
}

function dataOf({ receipt, steps, outputs }: RunLogEvent, runId: string): Schema.JsonObject {
  return {
    input: inputShown(receipt, runId),
    step_count: steps.length,
    steps: steps.slice(0, mostStepsShown).map((step) => stepShown(step)),
    output_kinds: [...new Set(outputs.map(({ kind }) => kind))],
  };
}

export const runPresenter: Presenter = {
  streamKind: runLogsKind,
  publicNames: { input_applied: ['workflow_input_applied', ...stepEventTypes] },
  present: (recorded) => {
    const event = decodeRunLogEvent(recorded.data);
    const runId = recorded.stream.slice(runLogsKind.length + 1);
    const record = { type: 'workflow_input_applied', summary: summaryOf(event), data: dataOf(event, runId) };
    return [record, ...stepFactsOf(event)];
  },
  changes: changingOne(runChanged, ['input_applied'], runChangedBy),
};
