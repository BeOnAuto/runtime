import type { Schema } from 'effect';

import type { RunAttempt } from '../capability/run-context.ts';
import type { CallEnd } from '../journal/call-numbering.ts';
import type { CancelRequestKind, Settlement } from '../runs/run-events.ts';
import type { RecordedAnswer, RecordedWork } from '../runs/run-state.ts';

export interface CancelledRun {
  readonly run: { readonly org: string; readonly playbook: string; readonly id: string };
  readonly record: Schema.JsonObject;
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly answer: RecordedAnswer | null;
  readonly work: readonly RecordedWork[];
}

export type CancelDecision = (run: CancelledRun) => Settlement;

export interface CancelledAttempt {
  readonly ends: readonly CallEnd[];
  readonly record?: Schema.JsonObject;
}

export interface Resumption<Parsed> {
  readonly afterMs: (parsed: Parsed) => number;
  readonly cancelledAttempt: (parsed: Parsed, attempt: RunAttempt) => CancelledAttempt;
}

export const nothingToEnd: CancelledAttempt = { ends: [] };

export function cancelledAsAsked({ kind, reason }: CancelledRun): Settlement {
  return { status: 'rejected', reason: 'cancelled', kind, detail: reason };
}
