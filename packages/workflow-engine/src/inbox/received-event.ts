import { Schema } from 'effect';

import { mostEventIdLength } from '../machine/limits.ts';

const EventIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostEventIdLength));

export const ReceivedEventSchema = Schema.StructWithRest(
  Schema.Struct({ id: EventIdSchema, type: Schema.NonEmptyString }),
  [Schema.Record(Schema.String, Schema.Json)],
);

export type ReceivedEvent = typeof ReceivedEventSchema.Type;
