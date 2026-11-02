import { Schema } from 'effect';

const RowSchema = Schema.Struct({
  kind: Schema.String,
  address: Schema.String,
  cursor: Schema.String,
  at: Schema.String,
  by: Schema.String,
  run_id: Schema.NullOr(Schema.String),
  waits_on: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  seen: Schema.NullOr(Schema.Boolean),
});

const CountsSchema = Schema.Struct({ needs_you: Schema.Int, broken: Schema.Int, new: Schema.Int });

const ThroughSchema = Schema.NullOr(Schema.Struct({ cursor: Schema.String, seen_at: Schema.String }));

export const activityOf = Schema.decodeUnknownSync(
  Schema.Struct({
    rows: Schema.Array(RowSchema),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
    counts: CountsSchema,
    through: ThroughSchema,
  }),
);

export const seenOf = Schema.decodeUnknownSync(Schema.Struct({ counts: CountsSchema, through: ThroughSchema }));

export type ActivityRead = ReturnType<typeof activityOf>;

export function addressesOf({ rows }: ActivityRead, kind: string): readonly string[] {
  return rows.filter((row) => row.kind === kind).map(({ address }) => address);
}
