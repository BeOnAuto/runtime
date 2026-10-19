import { Schema } from 'effect';

export interface NamedDefinition {
  readonly type: string;
  readonly name: string;
}

export type UserRelation = 'calls' | 'sends-builds' | 'asks-approval' | 'remembers-runs' | 'remembers-changes';

const CallingStepSchema = Schema.Struct({ number: Schema.Int, name: Schema.String });

export type CallingStep = typeof CallingStepSchema.Type;

export const CalledDefinitionSchema = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  role: Schema.optionalKey(Schema.Literals(['trainer', 'approver'])),
  steps: Schema.optionalKey(Schema.Array(CallingStepSchema)),
});

export type CalledDefinition = typeof CalledDefinitionSchema.Type;
