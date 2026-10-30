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

const NamingUserSchema = Schema.Struct({
  ...userFields,
  relation: Schema.Literals(['remembers-runs', 'remembers-changes']).annotate({
    description: 'remembers-runs or remembers-changes, for a recall function that folds its runs or its changes',
  }),
});

export const DefinitionUserSchema = Schema.Union([CallingUserSchema, NamingUserSchema]);

export type DefinitionUser = typeof DefinitionUserSchema.Type;

export type NamingRelation = (typeof NamingUserSchema.Type)['relation'];
