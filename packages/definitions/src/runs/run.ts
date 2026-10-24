import {
  CancelledKindSchema,
  ConflictKindSchema,
  InvalidInputKindSchema,
  IssueSchema,
  UnansweredKindSchema,
  RejectionBecauseSchema,
  UnavailableKindSchema,
} from '@on.auto/operations';
import { Schema } from 'effect';

import {
  isPlaybookFunctionType,
  type PlaybookFunctionDefinition,
  type WorkflowDefinition,
} from '../registry/definition.ts';
import { OutputShapeNameSchema } from '../shapes/shape-names.ts';
import { mostResultBytes } from './recorded-size.ts';

export const RunRejectionSchema = Schema.Union([
  Schema.Struct({
    reason: Schema.Literal('invalid_input'),
    detail: Schema.String,
    issues: Schema.Array(IssueSchema),
    kind: Schema.optionalKey(
      InvalidInputKindSchema.annotate({
        description:
          'What refused the input, when it was the definition before it ran: input_schema when the input does not match its input schema, which only a corrected input puts right',
      }),
    ),
  }),
  Schema.Struct({
    reason: Schema.Literal('unavailable'),
    detail: Schema.String,
    kind: Schema.optionalKey(
      UnavailableKindSchema.annotate({
        description:
          'What the run could not use, when known: model_not_offered for a model this server does not offer, tool_not_offered for a tool it does not offer, tool_server_failed for a tool server that failed before any tool was called, tools_unfinished for a run that called tools and could not finish, every one of which its server marks read-only, so running it again is safe, and rebuilding for a recall function whose view is still being built, which trying again later may resolve',
      }),
    ),
    because: Schema.optionalKey(
      RejectionBecauseSchema.annotate({
        description:
          'Why. With model_not_offered: provider_not_configured when its provider is not set up on this server while others are, model_not_allowed when it is outside the models the operator allows. With tool_not_offered: tool_server_not_configured, tool_not_allowed or tool_not_listed, or connection_pending, connection_broken, connection_not_allowed or connection_unavailable for a connection a person added. With tool_server_failed: failing, rate_limited, unreachable or key_refused. With tools_unfinished: server_failed, tool_error, model_unavailable, definition_refused, run_bound, no_answer or restarted_without_content',
      }),
    ),
  }),
  Schema.Struct({
    reason: Schema.Literal('conflict'),
    detail: Schema.String,
    kind: Schema.optionalKey(
      ConflictKindSchema.annotate({
        description:
          'What clashed, when it is known: unworkable for a definition that cannot run as written, such as a computation function whose program raised an error, gave no output or more than one, or did more work than a run may do, or an interaction function whose tool refused its arguments or answered nothing its output schema takes, which only changing the definition puts right; stalled for a recall function whose view stopped at an event its fold could not take, which a corrected version rebuilds; tools_called for a workflow whose step met a run of a function that may have called tools, which is not run again under its id; effect_unknown for a run that could not finish after calling a tool its server does not mark read-only, so whether the tool changed something is not known; oversized for a workflow whose output is larger than a run may record',
      }),
    ),
    because: Schema.optionalKey(
      RejectionBecauseSchema.annotate({
        description:
          'Why, with effect_unknown: server_failed, tool_error, model_unavailable, definition_refused, run_bound, no_answer, restarted_without_content or call_outcome_unknown',
      }),
    ),
  }),
  Schema.Struct({
    reason: Schema.Literal('cancelled'),
    detail: Schema.String,
    kind: CancelledKindSchema.annotate({
      description:
        'Why the run was cancelled: requested when someone allowed to change the playbook asked for it with cancel_run; deadline when the step that waited for it ran out of time; overrun when a workflow ran as long as a workflow may run; parent_ended when the run that waited for it ended first, or its branch of a race lost',
    }),
  }),
  Schema.Struct({
    reason: Schema.Literal('unanswered'),
    detail: Schema.String,
    kind: UnansweredKindSchema.annotate({
      description:
        'Why nobody answered what the run asked: expired when its request expired before an answer came; undelivered when a notification could not be delivered in any of its attempts',
    }),
  }),
]).annotate({ description: 'Why the run was rejected, that it was cancelled, or that nobody answered it' });

export type RunRejection = typeof RunRejectionSchema.Type;

export const RunSchema = Schema.Struct({
  run_id: Schema.String.annotate({ description: 'The run id, a UUID' }),
  type: Schema.String.annotate({
    description: 'The type of the definition: reasoning, interaction, prediction, recall, computation or workflow',
  }),
  name: Schema.String.annotate({ description: 'The definition name' }),
  definition_version: Schema.Int.annotate({ description: 'The definition version that ran' }),
  output_shape: Schema.optionalKey(
    OutputShapeNameSchema.annotate({
      description:
        'The output shape the output of this run takes, series, categories, table or text, which Auto Studio draws: that of its definition when the definition declares one and this kind of run answers it, as a question to a prediction function answers a series; left out otherwise, as for a build of a prediction function',
    }),
  ),
  status: Schema.Literals(['started', 'succeeded', 'rejected', 'failed']).annotate({
    description:
      'started while it runs, while work it started finishes later, or when it never finished; then succeeded, rejected or failed',
  }),
  output: Schema.optionalKey(
    Schema.Json.annotate({
      description: `The result, when the run succeeded: with the record, at most ${mostResultBytes} bytes as JSON in UTF-8`,
    }),
  ),
  rejection: Schema.optionalKey(RunRejectionSchema),
  started_at: Schema.String.annotate({ description: 'When the run started, in ISO 8601 UTC' }),
  started_by: Schema.String.annotate({ description: 'The id of the caller who started the run' }),
  finished_at: Schema.optionalKey(Schema.String.annotate({ description: 'When the run finished, in ISO 8601 UTC' })),
}).annotate({ identifier: 'Run', description: 'One run of a definition with an input, and how it ended' });

export type Run = typeof RunSchema.Type;

export type FunctionRun = Run & Pick<PlaybookFunctionDefinition, 'type'>;

export type WorkflowRun = Run & Pick<WorkflowDefinition, 'type'>;

export function isFunctionRun(run: Run): run is FunctionRun {
  return isPlaybookFunctionType(run.type);
}

export function isWorkflowRun(run: Run): run is WorkflowRun {
  return run.type === 'workflow';
}

export type RunRecord = Omit<Run, 'run_id'>;

export const RunDetailSchema = Schema.Struct({
  ...RunSchema.fields,
  record: Schema.optionalKey(
    Schema.JsonObject.annotate({
      description:
        'What the runtime adapter recorded: of the run that succeeded, of what a rejected run did before it was rejected, such as the tokens a model call used, or of the work it started that finishes later',
    }),
  ),
}).annotate({
  identifier: 'RunDetail',
  description: 'One run of a definition with an input, how it ended, and what its runtime adapter recorded',
});

export type RunDetail = typeof RunDetailSchema.Type;
