import { factReaderOf, type KeyedProjection, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import { ConversationCallEventSchema, conversationCallsKind, type ReadingRecorded } from '@on.auto/tool-servers';
import { Option, Schema } from 'effect';

import { interactionFactOf } from '../facts/run-facts.ts';
import type { RepliesIn } from '../tool-blocks/tool-block-schemas.ts';
import { firstReadWaitMs } from './cadence.ts';
import { conversationKeyOf } from './conversation-keys.ts';

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
});

export type ConversationRow = typeof ConversationRowSchema.Type;

export const conversationRowFrom: (row: ProjectedRow) => ConversationRow =
  Schema.decodeUnknownSync(ConversationRowSchema);

const decodeRow = Schema.decodeUnknownOption(ConversationRowSchema);

const readCall = factReaderOf(ConversationCallEventSchema);

export interface Cadence {
  readonly open: boolean;
  readonly active_at: number;
  readonly reads: number;
  readonly next_read_at: number | null;
}

export function advancedOf(cadence: Cadence): ProjectedRow {
  const { open, active_at: activeAt, reads, next_read_at: next } = cadence;
  return { open, active_at: activeAt, reads, next_read_at: next, due_at: open ? next : null };
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

function isReading(event: { readonly type: string }): event is ReadingRecorded {
  return event.type === 'replies_read' || event.type === 'reading_failed';
}

function readOf({ data }: ReadingRecorded): Read {
  const { server, tool, conversation, since } = data;
  return { kind: 'read', place: { server, tool, key: conversation }, since };
}

function conversationFactOf(message: ProjectedMessage): ConversationFact | undefined {
  const fact = interactionFactOf(message);
  if (fact?.type === 'delivery_succeeded') {
    const place = fact.data.replies_in;
    return place === undefined ? undefined : { kind: 'join', place, at: Date.parse(fact.context.at) };
  }
  const call = readCall(message);
  return call !== undefined && isReading(call) ? readOf(call) : undefined;
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
    ...advancedOf({ open: true, active_at: at, reads: 0, next_read_at: nextRead }),
  };
}

function rowAfter(row: ProjectedRow | undefined, message: ProjectedMessage): ProjectedRow | undefined {
  const fact = conversationFactOf(message);
  const kept = row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
  if (fact?.kind === 'join') {
    return joined(kept, fact, message);
  }
  return fact === undefined || kept === undefined ? undefined : { ...kept, since: fact.since, last_fact: message.id };
}

export const conversations: KeyedProjection = {
  name: conversationsName,
  version: 3,
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
  ],
  indexes: [{ name: 'due', columns: ['due_at'], acrossPlaybooks: true, whereSet: 'due_at' }],
  keyOf: (message) => {
    const fact = conversationFactOf(message);
    return fact === undefined ? undefined : conversationKeyOf(fact.place);
  },
  advanced: ['open', 'active_at', 'reads', 'next_read_at', 'due_at'].map((column) => ({
    column,
    setBy: ['delivery_succeeded'],
  })),
  rowAfter,
};
