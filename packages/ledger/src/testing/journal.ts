import { ActedContextSchema, factOf, type Decided, type Decider } from '@on.auto/operations';
import { Result, Schema } from 'effect';

import { stamped } from './happenings.ts';

const EntryWrittenSchema = factOf(
  'entry_written',
  Schema.Struct({
    at: Schema.Date,
    amount: Schema.BigInt,
    ratio: Schema.Number,
    tags: Schema.Array(Schema.String),
    memo: Schema.optionalKey(Schema.String),
    source: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  }),
  ActedContextSchema,
);

const EntryStruckSchema = factOf('entry_struck', Schema.Struct({ reason: Schema.String }), ActedContextSchema);

const JournalEventSchema = Schema.Union([EntryWrittenSchema, EntryStruckSchema]);

type RecordedJournalEvent = typeof JournalEventSchema.Type;

export type JournalEvent = Decided<RecordedJournalEvent>;

export const journal: Decider<readonly RecordedJournalEvent[], readonly JournalEvent[], RecordedJournalEvent> = {
  initialState: [],
  evolve: (written, recorded) => [...written, recorded],
  decide: (events) => Result.succeed(events),
  context: () => stamped,
  eventSchema: JournalEventSchema,
};
