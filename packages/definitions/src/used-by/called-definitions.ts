import { Schema } from 'effect';

export const NamedDefinitionSchema = Schema.Struct({ type: Schema.String, name: Schema.String });

export type NamedDefinition = typeof NamedDefinitionSchema.Type;

export const CallingStepSchema = Schema.Struct({
  number: Schema.Int.annotate({
    description:
      "The step's number: its place among the workflow's tasks in the order of its document, nested ones included",
  }),
  name: Schema.String.annotate({ description: 'The name of its task' }),
});

export type CallingStep = typeof CallingStepSchema.Type;

export const CalledDefinitionSchema = Schema.Struct({
  ...NamedDefinitionSchema.fields,
  steps: Schema.Array(CallingStepSchema),
});

export type CalledDefinition = typeof CalledDefinitionSchema.Type;
