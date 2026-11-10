import type { KeyedProjection, ProjectedMessage, ProjectedRow } from '@on.auto/operations';
import { conversationCallsKind, type ReadingRecorded } from '@on.auto/tool-servers';
import { Option, Schema } from 'effect';

import { interactionFactOf } from '../facts/run-facts.ts';
import type { RepliesIn } from '../tool-blocks/tool-block-schemas.ts';
import { firstReadWaitMs } from './cadence.ts';
import { conversationKeyOf } from './conversation-keys.ts';
import { readingRecordedOf } from './read-facts.ts';

export const conversationsName = 'conversations';

const ConversationRowSchema = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  conversation: Schema.String,
  since: Schema.NullOr(Schema.String),
  last_fact: Schema.String,
  joined_by: Schema.String,
  open: Schema.Boolean,
  active_at: Schema.Int,
  reads: Schema.Int,
  next_read_at: Schema.NullOr(Schema.Int),
  due_at: Schema.NullOr(Schema.Int),
  next_reading: Schema.Int,
  waited_after: Schema.NullOr(Schema.String),
});

export type ConversationRow = typeof ConversationRowSchema.Type;

export const conversationRowFrom: (row: ProjectedRow) => ConversationRow =
  Schema.decodeUnknownSync(ConversationRowSchema);

const decodeRow = Schema.decodeUnknownOption(ConversationRowSchema);

export interface Cadence {
  readonly open: boolean;
  readonly active_at: number;
  readonly reads: number;
  readonly next_read_at: number | null;
  readonly next_reading: number;
  readonly waited_after: string | null;
}

export function advancedOf(cadence: Cadence): ProjectedRow {
  const { open, active_at: activeAt, reads, next_read_at: next, next_reading: nextReading } = cadence;
  return {
    open,
    active_at: activeAt,
    reads,
    next_read_at: next,
    due_at: open ? next : null,
    next_reading: nextReading,
    waited_after: cadence.waited_after,
  };
}

interface Join {
  readonly kind: 'join';
  readonly place: RepliesIn;
  readonly at: number;
}

interface Read {
  readonly kind: 'read';
  readonly place: RepliesIn;
  readonly since: string | null;
}

type ConversationFact = Join | Read;

function readOf({ data }: ReadingRecorded): Read {
  const { server, tool, conversation, reading, since } = data;
  const place = { server, tool, key: conversation };
  return { kind: 'read', place: reading === undefined ? place : { ...place, reading }, since };
}

function conversationFactOf(message: ProjectedMessage): ConversationFact | undefined {
  const fact = interactionFactOf(message);
  if (fact?.type === 'delivery_succeeded') {
    const place = fact.data.replies_in;
    return place === undefined ? undefined : { kind: 'join', place, at: Date.parse(fact.context.at) };
  }
  const read = readingRecordedOf(message);
  return read === undefined ? undefined : readOf(read);
}

function joined(row: ConversationRow | undefined, { place, at }: Join, { id }: ProjectedMessage): ProjectedRow {
  const firstRead = at + firstReadWaitMs;
  const nextRead = Math.min(row?.next_read_at ?? firstRead, firstRead);
  return {
    server: place.server,
    tool: place.tool,
    conversation: place.key,
    since: row?.since ?? null,
    last_fact: id,
    joined_by: id,
    ...advancedOf({ open: true, active_at: at, reads: 0, next_read_at: nextRead, next_reading: 0, waited_after: null }),
  };
}

function afterRead(row: ConversationRow, { place, since }: Read, { id }: ProjectedMessage): ProjectedRow {
  return place.reading === undefined ? { ...row, since, last_fact: id } : { ...row, last_fact: id };
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = conversationFactOf(message);
  const kept = row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
  if (fact?.kind === 'join') {
    return joined(kept, fact, message);
  }
  return fact === undefined || kept === undefined ? undefined : afterRead(kept, fact, message);
}

const cadenceColumns: readonly string[] = ['open', 'active_at', 'reads', 'next_read_at', 'due_at'];

export const conversations: KeyedProjection = {
  name: conversationsName,
  version: 4,
  kinds: ['runs', conversationCallsKind],
  types: ['delivery_succeeded', 'replies_read', 'reading_failed'],
  columns: [
    { name: 'server', kind: 'text' },
    { name: 'tool', kind: 'text' },
    { name: 'conversation', kind: 'text' },
    { name: 'since', kind: 'text' },
    { name: 'last_fact', kind: 'text' },
    { name: 'joined_by', kind: 'text' },
    { name: 'open', kind: 'boolean' },
    { name: 'active_at', kind: 'integer' },
    { name: 'reads', kind: 'integer' },
    { name: 'next_read_at', kind: 'integer' },
    { name: 'due_at', kind: 'integer' },
    { name: 'next_reading', kind: 'integer' },
    { name: 'waited_after', kind: 'text' },
  ],
  indexes: [{ name: 'due', columns: ['due_at'], acrossPlaybooks: true, whereSet: 'due_at' }],
  keyOf: (message) => {
    const fact = conversationFactOf(message);
    return fact === undefined ? undefined : conversationKeyOf(fact.place);
  },
  advanced: [
    ...cadenceColumns.map((column) => ({ column, setBy: ['delivery_succeeded'] })),
    { column: 'next_reading', setBy: [] },
    { column: 'waited_after', setBy: [] },
  ],
  rowAfter,
};
