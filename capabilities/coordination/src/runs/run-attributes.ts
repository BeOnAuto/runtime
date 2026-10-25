import { CallerIdentitySchema } from '@on.auto/operations';
import { Schema } from 'effect';

const RunAttributesSchema = Schema.Struct({
  org: Schema.String,
  playbook: Schema.String,
  run_id: Schema.String,
  definition: Schema.Struct({ name: Schema.String, version: Schema.Int }),
  caller: CallerIdentitySchema,
  depth: Schema.optionalKey(Schema.Int),
  call_depth: Schema.optionalKey(Schema.Int),
  called_by: Schema.optionalKey(Schema.Struct({ run_id: Schema.String, reference: Schema.String, run: Schema.Int })),
  trigger: Schema.optionalKey(
    Schema.Struct({ kind: Schema.Literals(['event', 'cron', 'every']), reference: Schema.String }),
  ),
  lineage: Schema.optionalKey(Schema.Struct({ start: Schema.String, correlation: Schema.String })),
  resumes_after_ms_by_task: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
});

export type RunAttributes = typeof RunAttributesSchema.Type;

export const attributesOfRun = Schema.decodeUnknownOption(RunAttributesSchema);
