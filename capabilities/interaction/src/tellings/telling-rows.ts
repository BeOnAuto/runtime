import { factReaderOf, type KeyedProjection, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import {
  ConversationCallEventSchema,
  conversationCallsKind,
  type TellingEnded,
  type TellingFailedBecause,
} from '@on.auto/tool-servers';
import { Option, Schema } from 'effect';

export const tellingsName = 'tellings';

const TellingRowSchema = Schema.Struct({
  run_id: Schema.String,
  conversation: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  known: Schema.Boolean,
});

type TellingRow = typeof TellingRowSchema.Type;

const decodeRow = Schema.decodeUnknownOption(TellingRowSchema);

const tellingCall = factReaderOf(ConversationCallEventSchema);

const refusedBeforeAnythingWasPosted: ReadonlySet<TellingFailedBecause> = new Set([
  'tool_not_offered',
  'arguments_refused',
  'tool_error',
]);

function endedRow(row: TellingRow, ended: TellingEnded): TellingRow | undefined {
  if (ended.type === 'telling_failed') {
    return refusedBeforeAnythingWasPosted.has(ended.data.because) ? { ...row, known: true } : undefined;
  }
  const posted = ended.data.told_as;
  return posted === undefined
    ? undefined
    : { ...row, conversation: posted.conversation, message: posted.id, known: true };
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = tellingCall(message);
  if (fact?.type === 'telling_started') {
    return { run_id: fact.context.runId, conversation: null, message: null, known: false };
  }
  const kept = row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
  return kept === undefined || (fact?.type !== 'telling_succeeded' && fact?.type !== 'telling_failed')
    ? undefined
    : endedRow(kept, fact);
}

export const tellings: KeyedProjection = {
  name: tellingsName,
  version: 1,
  kinds: [conversationCallsKind],
  types: ['telling_started', 'telling_succeeded', 'telling_failed'],
  columns: [
    { name: 'run_id', kind: 'text' },
    { name: 'conversation', kind: 'text' },
    { name: 'message', kind: 'text' },
    { name: 'known', kind: 'boolean' },
  ],
  indexes: [
    { name: 'by_message', columns: ['conversation', 'message'] },
    { name: 'by_run', columns: ['run_id', 'known'] },
  ],
  rowAfter,
};
