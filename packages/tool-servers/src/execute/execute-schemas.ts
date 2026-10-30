import { Schema } from 'effect';

import { ArgumentsField, ServerField, ToolField } from '../names/tool-fields.ts';

export const ExecuteInputSchema = Schema.Struct({
  server: ServerField,
  tool: ToolField,
  arguments: Schema.optionalKey(ArgumentsField),
});

export const CalledOutcomeSchema = Schema.Literals([
  'result',
  'tool_error',
  'server_failure',
  'timed_out',
  'too_large',
]);

export type CalledOutcome = typeof CalledOutcomeSchema.Type;

export const ExecutedSchema = Schema.Struct({
  call_id: Schema.String.annotate({
    description: "The id of the call, a UUID, under which its two events are recorded in the playbook's history",
  }),
  server: Schema.String.annotate({ description: 'The tool server, as given' }),
  tool: Schema.String.annotate({ description: 'The tool, as given' }),
  outcome: CalledOutcomeSchema.annotate({
    description:
      "result when the tool answered; tool_error when it answered an error or refused the arguments, which a run's model may recover from; server_failure when its server failed on the call; timed_out when it did not answer in time; too_large when it answered more than one call may take",
  }),
  text: Schema.String.annotate({
    description:
      "What a reasoning function's model would see of the answer, scrubbed of the server's secrets and cut at 64 KiB with the note a run adds; for a failure, the words a run's model gets",
  }),
  answer: Schema.optionalKey(
    Schema.Json.annotate({
      description:
        "The document a call's read points into: the structured content, else the first text block parsed as JSON, else that text, scrubbed of the server's secrets; absent when the tool answered neither, and when it takes more than 64 KiB as JSON",
    }),
  ),
  result_bytes: Schema.NullOr(Schema.Int).annotate({
    description:
      "The size of the whole result as kept, scrubbed of its server's secrets, before the cut; null when there is none",
  }),
  duration_ms: Schema.Int.annotate({ description: 'How long the call took, in milliseconds' }),
  server_request_id: Schema.optionalKey(
    Schema.String.annotate({
      description: "The server's own id of the request, where whoever runs this server says where it carries one",
    }),
  ),
  called_at: Schema.String.annotate({ description: 'When the call was made, in ISO 8601 UTC' }),
});
