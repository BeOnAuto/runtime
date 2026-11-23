import { Schema } from 'effect';

import { everyActivityKind } from '../operations/activity-row.ts';

const PositionSchema = Schema.Struct({
  at: Schema.Number,
  resultAt: Schema.optionalKey(Schema.Number),
  playbook: Schema.String,
  key: Schema.String,
});

const ActivityKindSchema = Schema.Literals(everyActivityKind);

const ItemFormSchema = Schema.Literals(['request', 'broken', 'result', 'version', 'playbook', 'comment', 'assessment']);

const GoalShownSchema = Schema.Struct({
  goalKey: Schema.String,
  outcome: Schema.Literals(['passed', 'failed', 'overdue']),
  title: Schema.NullOr(Schema.String),
  says: Schema.NullOr(Schema.String),
  resultAt: Schema.Number,
});

const ActivityRowWireSchema = Schema.Struct({
  kind: ActivityKindSchema,
  form: ItemFormSchema,
  position: PositionSchema,
  by: Schema.String,
  by_name: Schema.NullOr(Schema.String),
  change: Schema.NullOr(Schema.Literals(['created', 'updated'])),
  trigger: Schema.NullOr(Schema.Struct({ kind: Schema.String, reference: Schema.String })),
  definition: Schema.NullOr(Schema.Struct({ type: Schema.String, name: Schema.String, version: Schema.Number })),
  run_id: Schema.NullOr(Schema.String),
  output_shape: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  answer_schema: Schema.NullOr(Schema.JsonObject),
  detail: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.Literals(['failed', 'rejected'])),
  waits_on: Schema.NullOr(Schema.String),
  expires_at: Schema.NullOr(Schema.Number),
  about: Schema.NullOr(Schema.String),
  definitionId: Schema.optionalKey(Schema.String),
  reopenedBy: Schema.optionalKey(Schema.String),
  goal: Schema.optionalKey(GoalShownSchema),
});

const OpenRequestSetAsideSchema = Schema.Struct({
  waitsOn: Schema.String,
  setAside: Schema.Struct({ goal: Schema.String, id: Schema.String, at: Schema.String, by: Schema.String }),
});

export const ActivityOfAPlaybookSchema = Schema.Struct({
  setAside: Schema.ReadonlyMap(Schema.String, OpenRequestSetAsideSchema),
  counts: Schema.Record(Schema.String, Schema.Number),
  rows: Schema.Array(ActivityRowWireSchema),
  goalNames: Schema.ReadonlyMap(Schema.String, Schema.String),
});

const ViewerSchema = Schema.Struct({
  caller: Schema.String,
  seen: Schema.Struct({
    through: Schema.UndefinedOr(PositionSchema),
    marks: Schema.Array(Schema.Struct({ address: Schema.String, at: Schema.Number })),
    seenAt: Schema.NullOr(Schema.Number),
  }),
  through: PositionSchema,
  marked: Schema.ReadonlyMap(Schema.String, Schema.Number),
});

export const PageOfPlaybooksSchema = Schema.Struct({
  kinds: Schema.Array(ActivityKindSchema),
  mine: Schema.NullOr(Schema.String),
  limit: Schema.Number,
  cursor: Schema.NullOr(PositionSchema),
  since: Schema.NullOr(PositionSchema),
  dismissed: Schema.Boolean,
});

export const PlaybookActivityAskedSchema = Schema.Struct({
  viewer: ViewerSchema,
  page: Schema.NullOr(PageOfPlaybooksSchema),
  paged: Schema.Array(Schema.String),
});
