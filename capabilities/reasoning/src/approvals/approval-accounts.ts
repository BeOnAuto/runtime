import { Buffer } from 'node:buffer';

import {
  defaultRunWords,
  isRequestRecord,
  type CancelDecision,
  type RunAccount,
  type RunWords,
} from '@on.auto/definitions';
import type { Schema } from 'effect';

import { spentIn } from './approval-requests.ts';
import { waitingWords } from './approval-words.ts';

function approvalAccount(record: Schema.JsonObject): RunAccount | undefined {
  if (!isRequestRecord(record) || record.approval === undefined) {
    return undefined;
  }
  const { approval, to, message, expires_at: expiresAt } = record;
  return {
    summary: waitingWords(approval.server, expiresAt),
    data: {
      delivery: null,
      to,
      message_bytes: Buffer.byteLength(message, 'utf8'),
      takes_answer: true,
      expires_at: expiresAt,
      approval: { server: approval.server, tool: approval.tool },
    },
  };
}

export const reasoningRunWords: RunWords = {
  ...defaultRunWords,
  deferralType: 'interaction_requested',
  deferral: approvalAccount,
};

export const cancelledKeepingWhatItSpent: CancelDecision = ({ kind, reason, record }) => ({
  status: 'rejected',
  reason: 'cancelled',
  kind,
  detail: reason,
  ...spentIn(record),
});
