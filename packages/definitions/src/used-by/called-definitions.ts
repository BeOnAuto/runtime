import { Schema } from 'effect';

export interface NamedDefinition {
  readonly type: string;
  readonly name: string;
}

export const CallingStepSchema = Schema.Struct({
  number: Schema.Int.annotate({
    description:
      "The step's number: its place among the workflow's tasks in the order of its document, nested ones included",
  }),
  name: Schema.String.annotate({ description: 'The name of its task' }),
});

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
