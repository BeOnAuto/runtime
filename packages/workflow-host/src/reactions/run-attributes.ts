import { Schema } from 'effect';

const ReactionAttributesSchema = Schema.Struct({
  definition: Schema.Struct({ name: Schema.String, version: Schema.Int }),
  caller: Schema.Struct({ id: Schema.String }),
  depth: Schema.optionalKey(Schema.Int),
  lineage: Schema.optionalKey(Schema.Struct({ correlation: Schema.String })),
});

export interface RunReaction {
  readonly workflow: string;
  readonly version: number;
  readonly caller: string;
  readonly depth: number;
  readonly correlation: string | undefined;
}

const decodeAttributes = Schema.decodeUnknownSync(ReactionAttributesSchema);

export function reactionOfRun(attributes: Schema.JsonObject): RunReaction {
  const { definition, caller, depth = 0, lineage } = decodeAttributes(attributes);
  return {
    workflow: definition.name,
    version: definition.version,
    caller: caller.id,
    depth,
    correlation: lineage?.correlation,
  };
}
