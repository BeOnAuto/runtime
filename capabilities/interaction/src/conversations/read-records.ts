import { argumentsFailureWords, type ArgumentsFailure } from '@on.auto/definitions/tool-blocks';
import { playbookCallerOf, randomUUIDv7, streamPrefixOfPlaybook, type StreamWriter } from '@on.auto/operations';
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

import { routeOfRequest } from '../replies/request-routes.ts';
import { isWoken, type ConversationRow } from './conversation-rows.ts';
import { failedRead, type ReadAnswer } from './read-answers.ts';
import type { ConversationTurn, OneRead, ReadDone } from './turn-parts.ts';

export interface ReadRecord {
  readonly start: StartedFields | ToolReference;
  readonly called?: CalledOnce;
  readonly detail?: string;
  readonly answer: ReadAnswer;
  readonly state: ReadDone['state'];
  readonly callId: string;
  readonly reading: string | undefined;
  readonly since: string | null;
}

function readFactOf(record: ReadRecord, row: ConversationRow, recorded: Recorded): ConversationCall {
  const { start, called, detail, answer, state, callId, reading, since } = record;
  const read = { callId, start, conversation: row.conversation, ...(reading === undefined ? {} : { reading }), since };
  if (answer.outcome === 'result') {
    const { taken, refused } = state;
    const found = { answered: answer.answered, replies: answer.considered, taken, refused, woken: isWoken(row) };
    return repliesReadOf({ ...read, ...found }, recorded);
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
  { playbook, row }: ConversationTurn['place'],
  record: ReadRecord,
): Effect.Effect<void> {
  const stream = `${streamPrefixOfPlaybook(playbook)}${conversationCallStreamOf(record.callId)}`;
  return Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now);
    const fact = readFactOf(record, row, { by: playbookCallerOf(playbook).id, at });
    yield* ledger
      .execute(stream, conversationCallDecider, fact, { causationId: row.last_fact, correlationId: null })
      .pipe(Effect.orDie);
  });
}

export function unsentRead(
  { parts, place }: ConversationTurn,
  read: OneRead,
  failure: ArgumentsFailure,
  carried: ReadDone['state'],
): Effect.Effect<ReadDone> {
  const route = routeOfRequest(read.request);
  const unsent = { answer: failedRead('not_sent'), state: carried };
  const record = {
    start: { server: route.server, tool: route.replies.tool },
    detail: argumentsFailureWords(failure, 'the read'),
    ...unsent,
    callId: randomUUIDv7(),
    reading: read.reading,
    since: read.since,
  };
  return Effect.as(recordedRead(parts.ledger, place, record), unsent);
}
