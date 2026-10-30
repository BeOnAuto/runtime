import { Option, Result, Schema } from 'effect';

import { ActedContextSchema, type Context } from '../ledger/context.ts';
import { factOf, type Decided, type Decider } from '../ledger/decider.ts';
import type { KeyedProjection, ProjectedMessage, ProjectedRow } from './keyed-projection.ts';

const OpenedSchema = factOf(
  'topic_opened',
  Schema.Struct({ topic: Schema.String, at: Schema.Int }),
  ActedContextSchema,
);

const NotedSchema = factOf(
  'topic_noted',
  Schema.Struct({ topic: Schema.String, note: Schema.String }),
  ActedContextSchema,
);

const TopicFactSchema = Schema.Union([OpenedSchema, NotedSchema]);

type RecordedTopicFact = typeof TopicFactSchema.Type;

export type TopicFact = Decided<RecordedTopicFact>;

const topicContext: Context = { at: '2026-10-05T09:00:00.000Z', by: 'topics' };

export const topicFacts: Decider<null, readonly TopicFact[], RecordedTopicFact> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  context: () => topicContext,
  eventSchema: TopicFactSchema,
};

const decodeFact = Schema.decodeUnknownOption(TopicFactSchema);

export const topicWaitMs = 5000;

function rowAfterFact(
  row: ProjectedRow | undefined,
  fact: RecordedTopicFact,
  { id }: ProjectedMessage,
): ProjectedRow | undefined {
  if (fact.type === 'topic_opened') {
    const nextAt = fact.data.at + topicWaitMs;
    return {
      topic: fact.data.topic,
      note: row?.['note'] ?? null,
      last_message: id,
      open: true,
      next_at: nextAt,
      due_at: nextAt,
    };
  }
  return row === undefined ? undefined : { ...row, note: fact.data.note, last_message: id };
}

export const topicRows: KeyedProjection = {
  name: 'topics',
  version: 2,
  kinds: ['runs', 'notes'],
  types: ['topic_opened', 'topic_noted'],
  columns: [
    { name: 'topic', kind: 'text' },
    { name: 'note', kind: 'text' },
    { name: 'last_message', kind: 'text' },
    { name: 'open', kind: 'boolean' },
    { name: 'next_at', kind: 'integer' },
    { name: 'due_at', kind: 'integer' },
  ],
  indexes: [{ name: 'due', columns: ['due_at'], acrossPlaybooks: true, whereSet: 'due_at' }],
  keyOf: (message) => Option.getOrUndefined(Option.map(decodeFact(message), (fact) => fact.data.topic)),
  advanced: [
    { column: 'open', setBy: ['topic_opened'] },
    { column: 'next_at', setBy: ['topic_opened'] },
    { column: 'due_at', setBy: ['topic_opened'] },
  ],
  rowAfter: (row, message) =>
    Option.getOrUndefined(Option.flatMapNullishOr(decodeFact(message), (fact) => rowAfterFact(row, fact, message))),
};
