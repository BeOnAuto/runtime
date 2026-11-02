import { ActedContextSchema, PlaybookIdSchema, factOf, uuidV5, type Decider } from '@on.auto/operations';
import { Result, Schema } from 'effect';

const SeenItemSchema = Schema.Struct({ address: Schema.String, at: Schema.String });

const SeenThroughSchema = Schema.Struct({
  at: Schema.String,
  playbook: Schema.Union([PlaybookIdSchema, Schema.Literal('')]),
  key: Schema.String,
});

export const ActivitySeenSchema = factOf(
  'activity_seen',
  Schema.Struct({ items: Schema.Array(SeenItemSchema), through: Schema.optionalKey(SeenThroughSchema) }),
  ActedContextSchema,
);

export type RecordedActivitySeen = typeof ActivitySeenSchema.Type;

export type SeenItem = typeof SeenItemSchema.Type;

export type SeenThrough = typeof SeenThroughSchema.Type;

export interface SeenCommand {
  readonly items: readonly SeenItem[];
  readonly through?: SeenThrough;
  readonly at: string;
  readonly by: string;
}

export const activityStreamKind = 'activity';

const callersSeen = '6f1d2c8a-4b7e-5a39-9c02-d8e1f3a4b5c6';

export function activityStreamOf(caller: string): string {
  return `${activityStreamKind}/${uuidV5(callersSeen, caller)}`;
}

export const seenDecider: Decider<null, SeenCommand, RecordedActivitySeen> = {
  initialState: null,
  evolve: () => null,
  decide: ({ items, through }) =>
    Result.succeed([{ type: 'activity_seen', data: through === undefined ? { items } : { items, through } }]),
  context: ({ at, by }) => ({ at, by }),
  eventSchema: ActivitySeenSchema,
};
