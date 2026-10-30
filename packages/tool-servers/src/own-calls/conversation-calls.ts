import type { Context, RunContext } from '@on.auto/operations';
import { Struct } from 'effect';

import type { CallAnswered } from '../calls/call-facts.ts';
import type { StartedFields } from '../calls/recorded-calls.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { CalledOnce } from '../one-call/called-once.ts';
import {
  ConversationCallEventSchema,
  type RecordedConversationCall,
  type ReadingFailedBecause,
  type ReadingRecorded,
  type TellingEnded,
  type TellingStarted,
} from './conversation-call-events.ts';
import { ownCallDecider, type OwnCall } from './own-call-decider.ts';

export const conversationCallDecider = ownCallDecider<RecordedConversationCall>({
  first: ['telling_started', 'replies_read', 'reading_failed'],
  after: { telling_started: ['telling_succeeded', 'telling_failed'] },
  eventSchema: ConversationCallEventSchema,
  outOfTurn:
    'A call of the playbook in a conversation records the start of a telling once and then how it ended once, or a read once, so this is not recorded',
});

export type Recorded = Pick<Context, 'by' | 'at'>;

export type ConversationCall = OwnCall<RecordedConversationCall>;

export type DefinitionOfTheTelling = Pick<RunContext, 'definitionType' | 'definitionName' | 'definitionVersion'>;

export interface Telling {
  readonly callId: string;
  readonly runId: string;
  readonly definition: DefinitionOfTheTelling;
}

function answeredOf(answered: CallAnswered) {
  return Struct.omit(answered, ['is_error', 'shown_bytes']);
}

function endOf(end: CalledOnce | undefined) {
  if (end?.kind !== 'answered') {
    return {};
  }
  return 'failed' in end ? end.failed : answeredOf(end.answered);
}

function detailOf(detail: string | undefined) {
  return detail === undefined || detail === '' ? {} : { detail };
}

function tellingContextOf({ runId, definition }: Telling, recorded: Recorded): Context {
  return { ...recorded, runId, ...definition };
}

export function tellingStartedOf(telling: Telling, start: StartedFields, recorded: Recorded): ConversationCall {
  const event: TellingStarted = { type: 'telling_started', data: { call_id: telling.callId, ...start } };
  return { event, context: tellingContextOf(telling, recorded) };
}

function tellingEnd(callId: string, end: CalledOnce): TellingEnded {
  if (end.kind === 'unopened') {
    const because = end.refused === 'tool_not_offered' ? 'tool_not_offered' : 'server_failure';
    return { type: 'telling_failed', data: { call_id: callId, because, ...detailOf(end.detail) } };
  }
  if (end.outcome === 'result') {
    return { type: 'telling_succeeded', data: { call_id: callId, ...answeredOf(end.answered) } };
  }
  return {
    type: 'telling_failed',
    data: { call_id: callId, ...endOf(end), because: end.outcome, ...detailOf(end.detail) },
  };
}

export function tellingEndedOf(telling: Telling, end: CalledOnce, recorded: Recorded): ConversationCall {
  return { event: tellingEnd(telling.callId, end), context: tellingContextOf(telling, recorded) };
}

interface ReadPlace {
  readonly callId: string;
  readonly start: StartedFields | ToolReference;
  readonly conversation: string;
  readonly since: string | null;
}

export interface RepliesRead extends ReadPlace {
  readonly answered: CallAnswered;
  readonly replies: number;
  readonly taken: number;
  readonly refused: number;
}

export interface ReadingFailed extends ReadPlace {
  readonly because: ReadingFailedBecause;
  readonly end?: CalledOnce;
  readonly detail?: string;
  readonly retryAfterMs: number | null;
}

function argumentsOf(start: StartedFields | ToolReference) {
  if (!('arguments_bytes' in start)) {
    return {};
  }
  const { arguments_bytes, arguments_sha256 } = start;
  return { arguments_bytes, ...(arguments_sha256 === undefined ? {} : { arguments_sha256 }) };
}

function connectionOf(start: StartedFields | ToolReference) {
  return 'connection_id' in start && start.connection_id !== undefined ? { connection_id: start.connection_id } : {};
}

function ofTheRead({ callId, start, conversation, since }: ReadPlace) {
  return {
    call_id: callId,
    server: start.server,
    ...connectionOf(start),
    tool: start.tool,
    conversation,
    since,
    ...argumentsOf(start),
  };
}

export function repliesReadOf(read: RepliesRead, recorded: Recorded): ConversationCall {
  const { replies, taken, refused } = read;
  const event: ReadingRecorded = {
    type: 'replies_read',
    data: { ...ofTheRead(read), ...answeredOf(read.answered), replies, taken, refused },
  };
  return { event, context: recorded };
}

export function readingFailedOf(failed: ReadingFailed, recorded: Recorded): ConversationCall {
  const event: ReadingRecorded = {
    type: 'reading_failed',
    data: {
      ...ofTheRead(failed),
      ...endOf(failed.end),
      because: failed.because,
      ...detailOf(failed.detail),
      ...(failed.retryAfterMs === null ? {} : { retry_after_ms: failed.retryAfterMs }),
    },
  };
  return { event, context: recorded };
}
