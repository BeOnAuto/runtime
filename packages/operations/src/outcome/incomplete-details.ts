import { Schema } from 'effect';

export const IncompleteReasonSchema = Schema.Literals(['max_tool_calls', 'max_input_tokens', 'max_output_tokens']);

export type IncompleteReason = typeof IncompleteReasonSchema.Type;

export const IncompleteDetailsSchema = Schema.Struct({
  reason: IncompleteReasonSchema.annotate({
    description:
      'The limit it reached: max_tool_calls when it had made all the tool calls it may make, or max_input_tokens when it had read all the input tokens a run may read, and so answered from what it had; max_output_tokens when its answer was cut off at the most output tokens a model call of its definition may write, its config.max_output_tokens',
  }),
}).annotate({
  identifier: 'IncompleteDetails',
  description:
    'On a run that succeeded with an answer a limit shaped, which may leave something out: the limit it reached. Left out on a run that answered within its limits',
});

export type IncompleteDetails = typeof IncompleteDetailsSchema.Type;
