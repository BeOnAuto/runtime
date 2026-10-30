import { ActedContextSchema, factOf, type Decider } from '@on.auto/operations';
import { Result, Schema } from 'effect';

import { stamped } from './happenings.ts';

const NotedSchema = factOf('noted', Schema.Record(Schema.String, Schema.Json), ActedContextSchema);

type Noted = typeof NotedSchema.Type;

type Details = Noted['data'];

export const notes: Decider<readonly Details[], readonly Details[], Noted> = {
  initialState: [],
  evolve: (written, { data }) => [...written, data],
  decide: (written) => Result.succeed(written.map((details) => ({ type: 'noted', data: details }))),
  context: () => stamped,
  eventSchema: NotedSchema,
};
