import { playbookCallerOf, streamPrefixOfPlaybook, type StreamWriter } from '@on.auto/operations';
import {
  conversationCallDecider,
  conversationCallStreamOf,
  readingFailedOf,
  repliesReadOf,
  type CalledOnce,
  type ConversationCall,
  type Recorded,
  type StartedFields,
} from '@on.auto/tool-servers';
import type { ToolReference } from '@on.auto/tool-servers/policy';
import { DateTime, Effect } from 'effect';

import type { ReadingState } from '../replies/reply-recording.ts';
import type { ConversationPlace } from './conversation-parts.ts';
import type { ReadAnswer } from './read-answers.ts';

export interface ReadRecord {
  readonly start: StartedFields | ToolReference;
  readonly called?: CalledOnce;
  readonly detail?: string;
  readonly answer: ReadAnswer;
  readonly state: ReadingState;
  readonly callId: string;
  readonly since: string | null;
}

function readFactOf(
  { start, called, detail, answer, state, callId, since }: ReadRecord,
  conversation: string,
  recorded: Recorded,
): ConversationCall {
  const read = { callId, start, conversation, since };
  if (answer.outcome === 'result') {
    const { taken, refused } = state;
    return repliesReadOf({ ...read, answered: answer.answered, replies: answer.considered, taken, refused }, recorded);
  }
  return readingFailedOf(
    {
      ...read,
      because: answer.outcome,
      ...(called === undefined ? {} : { end: called }),
      ...(detail === undefined ? {} : { detail }),
      retryAfterMs: answer.retryAfterMs,
    },
    recorded,
  );
}

export function recordedRead(
  ledger: StreamWriter,
  { playbook, row }: ConversationPlace,
  record: ReadRecord,
): Effect.Effect<void> {
  const stream = `${streamPrefixOfPlaybook(playbook)}${conversationCallStreamOf(record.callId)}`;
  return Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now);
    const fact = readFactOf(record, row.conversation, { by: playbookCallerOf(playbook).id, at });
    yield* ledger
      .execute(stream, conversationCallDecider, fact, { causationId: row.last_fact, correlationId: null })
      .pipe(Effect.orDie);
  });
}
