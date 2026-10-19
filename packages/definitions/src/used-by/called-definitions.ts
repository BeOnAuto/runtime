import { Schema } from 'effect';

export interface NamedDefinition {
  readonly type: string;
  readonly name: string;
}

export type UserRelation = 'calls' | 'sends-builds' | 'asks-approval' | 'remembers-runs' | 'remembers-changes';

const CallingStepSchema = Schema.Struct({ number: Schema.Int, name: Schema.String });

export type CallingStep = typeof CallingStepSchema.Type;

const CallRoleSchema = Schema.Literals(['trainer', 'approver']);

export type CallRole = typeof CallRoleSchema.Type;

const CallByRoleSchema = Schema.Struct({ type: Schema.String, name: Schema.String, role: CallRoleSchema });

const CallByStepsSchema = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  steps: Schema.Array(CallingStepSchema),
});

export const CalledDefinitionSchema = Schema.Union([CallByRoleSchema, CallByStepsSchema]);

export type CalledDefinition = typeof CalledDefinitionSchema.Type;
