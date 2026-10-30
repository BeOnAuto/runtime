import type { Context } from '@on.auto/operations';
import { Schema } from 'effect';

const RunLogAttributesSchema = Schema.Struct({
  run_id: Schema.String,
  definition: Schema.Struct({ name: Schema.String, version: Schema.Int }),
  caller: Schema.Struct({ id: Schema.String }),
  depth: Schema.optionalKey(Schema.Int),
  call_depth: Schema.optionalKey(Schema.Int),
  called_by: Schema.optionalKey(Schema.Struct({ run_id: Schema.String, reference: Schema.String, run: Schema.Int })),
  trigger: Schema.optionalKey(
    Schema.Struct({ kind: Schema.Literals(['event', 'cron', 'every']), reference: Schema.String }),
  ),
});

type RunLogAttributes = typeof RunLogAttributesSchema.Type;

const decodeAttributes = Schema.decodeUnknownSync(RunLogAttributesSchema);

function counted(count: number | undefined): number | undefined {
  return count === undefined || count < 1 ? undefined : count;
}

function chainOf({ depth, call_depth: callDepth, called_by: calledBy, trigger }: RunLogAttributes) {
  const deep = counted(depth);
  const callDeep = counted(callDepth);
  return {
    ...(calledBy === undefined
      ? {}
      : { calledBy: { runId: calledBy.run_id, reference: calledBy.reference, run: calledBy.run } }),
    ...(callDeep === undefined ? {} : { callDepth: callDeep }),
    ...(deep === undefined ? {} : { depth: deep }),
    ...(trigger === undefined ? {} : { trigger }),
  };
}

export function runLogContextOf(attributes: Schema.JsonObject, at: string): Context {
  const run = decodeAttributes(attributes);
  return {
    at,
    by: run.caller.id,
    runId: run.run_id,
    definitionType: 'workflow',
    definitionName: run.definition.name,
    definitionVersion: run.definition.version,
    ...chainOf(run),
  };
}
