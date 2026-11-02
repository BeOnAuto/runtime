import { ActedContextSchema, factOf, type Decided } from '@on.auto/operations';
import { Schema } from 'effect';

import {
  argumentsHeld,
  CallAnsweredSchema,
  CallFailedSchema,
  CallStartedSchema,
  resultHeld,
} from '../calls/call-facts.ts';

export const handCallsKind = 'tool-calls';

export const HandCallEventSchema = Schema.Union([
  factOf('tool_call_started', CallStartedSchema, ActedContextSchema, argumentsHeld),
  factOf('tool_call_answered', CallAnsweredSchema, ActedContextSchema, resultHeld),
  factOf('tool_call_failed', CallFailedSchema, ActedContextSchema),
]);

export type RecordedHandCall = typeof HandCallEventSchema.Type;

export type HandCallEvent = Decided<RecordedHandCall>;

export function handCallStreamOf(callId: string): string {
  return `${handCallsKind}/${callId}`;
}
