import { Schema } from 'effect';

import { CallingStepSchema } from './called-definitions.ts';

const userFields = {
  type: Schema.String.annotate({ description: 'The type of the definition that uses this one' }),
  name: Schema.String.annotate({ description: 'The name of the definition that uses this one' }),
};

const CallingUserSchema = Schema.Struct({
  ...userFields,
  relation: Schema.Literal('calls').annotate({ description: 'calls, for a workflow that runs this one in its steps' }),
  steps: Schema.Array(CallingStepSchema).annotate({ description: 'The steps of the workflow that call this one' }),
});

const ReadingUserSchema = Schema.Struct({
  ...userFields,
  relation: Schema.Literal('reads').annotate({
    description: 'reads, for a lookup function that answers with the outputs of the runs of this one',
  }),
});

export const DefinitionUserSchema = Schema.Union([CallingUserSchema, ReadingUserSchema]);

export type DefinitionUser = typeof DefinitionUserSchema.Type;
