import { Schema } from 'effect';

import { IssueSchema } from './issue.ts';

export const invalidArguments = 'invalid_arguments';

export const CallResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json }),
  Schema.Struct({
    status: Schema.Literal('rejected'),
    reason: Schema.String,
    detail: Schema.String,
    kind: Schema.optionalKey(Schema.String),
    because: Schema.optionalKey(Schema.String),
    issues: Schema.optionalKey(Schema.Array(IssueSchema)),
    resolve_at: Schema.optionalKey(Schema.String),
    admission: Schema.optionalKey(Schema.Literal('refused')),
  }),
  Schema.Struct({ status: Schema.Literal('failed'), detail: Schema.String }),
  Schema.Struct({ status: Schema.Literal('unreachable'), detail: Schema.String }),
]);

export type CallResult = typeof CallResultSchema.Type;

export type RejectedCall = Extract<CallResult, { readonly status: 'rejected' }>;

export type CallStatus = CallResult['status'];
