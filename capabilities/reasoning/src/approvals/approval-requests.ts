import { ApprovalRecordSchema } from '@on.auto/definitions';
import type { AskedApproval } from '@on.auto/tool-servers';
import { Option, Schema } from 'effect';

import { approvalBounds } from './approval-bounds.ts';
import { requestMessageOf } from './approval-words.ts';
import type { PendingApproval } from './pending-approvals.ts';

export interface ApprovalAsking {
  readonly person: string;
  readonly at: number;
  readonly functionName: string;
  readonly approval: PendingApproval;
  readonly numbering: { readonly lastCall: number; readonly lastModelCall: number };
  readonly spent: Schema.JsonObject | undefined;
}

export const approvalAnswerSchema: Schema.JsonObject = {
  type: 'object',
  properties: {
    approved: { type: 'boolean', description: 'true lets the run take the action once; false declines it' },
    reason: {
      type: 'string',
      maxLength: approvalBounds.reasonCharacters,
      description: 'Why the person declined, which the run is told',
    },
  },
  required: ['approved'],
  additionalProperties: false,
};

function actionShown(action: string): string {
  return Array.from(action).slice(0, approvalBounds.actionCharacters).join('');
}

function askedRecordOf({ request, tool, digest, action, expires_at: expiresAt, kind, site, person }: AskedApproval) {
  return {
    request,
    tool,
    digest,
    action,
    expires_at: expiresAt,
    ...(kind === undefined ? {} : { kind }),
    ...(site === undefined ? {} : { site }),
    ...(person === undefined ? {} : { person }),
  };
}

function approvalOf({ approval: { server, asked } }: ApprovalAsking): typeof ApprovalRecordSchema.Type {
  const { site, kind } = asked;
  return {
    server,
    tool: asked.tool,
    action: actionShown(asked.action),
    ...(site === undefined ? {} : { site }),
    ...(kind === undefined ? {} : { kind }),
  };
}

function expiryOf({ at, approval }: ApprovalAsking): string {
  return new Date(Math.min(Date.parse(approval.asked.expires_at), at + approvalBounds.waitMs)).toISOString();
}

export function approvalRequestOf(asking: ApprovalAsking): Schema.JsonObject {
  const { person, at, functionName, approval, numbering, spent } = asking;
  const shown = approvalOf(asking);
  return {
    to: person,
    answerer: person,
    message: requestMessageOf({ functionName, ...shown }),
    answer_schema: approvalAnswerSchema,
    expires_at: expiryOf(asking),
    requested_at: new Date(at).toISOString(),
    approval: shown,
    call: {
      number: approval.number,
      call_id: approval.callId,
      last_call: numbering.lastCall,
      last_model_call: numbering.lastModelCall,
      asked: askedRecordOf(approval.asked),
    },
    ...(spent === undefined ? {} : { spent }),
  };
}

const AskedSchema = Schema.Struct({
  request: Schema.NullOr(Schema.String),
  tool: Schema.String,
  digest: Schema.String,
  action: Schema.String,
  expires_at: Schema.String,
  kind: Schema.optionalKey(Schema.String),
  site: Schema.optionalKey(Schema.String),
  person: Schema.optionalKey(Schema.String),
});

const WaitedApprovalSchema = Schema.Struct({
  expires_at: Schema.String,
  approval: ApprovalRecordSchema,
  call: Schema.Struct({
    number: Schema.Int,
    call_id: Schema.String,
    last_call: Schema.Int,
    last_model_call: Schema.Int,
    asked: AskedSchema,
  }),
});

export type WaitedApproval = typeof WaitedApprovalSchema.Type;

const decodeWaited = Schema.decodeUnknownOption(WaitedApprovalSchema);

export function waitedApprovalOf(record: Schema.JsonObject): WaitedApproval | undefined {
  return Option.getOrUndefined(decodeWaited(record));
}

const decodeSpent = Schema.decodeUnknownOption(Schema.Struct({ spent: Schema.JsonObject }));

export function spentIn(record: Schema.JsonObject): { readonly record?: Schema.JsonObject } {
  return Option.match(decodeSpent(record), {
    onNone: () => ({}),
    onSome: ({ spent }) => ({ record: spent }),
  });
}

const AnswerSchema = Schema.Struct({
  approved: Schema.Boolean,
  reason: Schema.optionalKey(Schema.String),
});

export type ApprovalAnswer = typeof AnswerSchema.Type;

const decodeAnswer = Schema.decodeUnknownOption(AnswerSchema);

export function approvalAnswerOf(answer: Schema.Json): ApprovalAnswer | undefined {
  return Option.getOrUndefined(decodeAnswer(answer));
}
