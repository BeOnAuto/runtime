import type { CallToolResult } from '@modelcontextprotocol/server';

import { confirmationNeededKey } from '../calls/asked-approvals.ts';
import { approvalKey } from '../calls/call-meta.ts';
import type { FakeTool } from './fake-tools.ts';

export interface ApprovalAsking {
  readonly name?: string;
  readonly request?: string | null;
  readonly expiresAt?: string;
  readonly asksAgain?: boolean;
}

export const askedDigest = 'sha256-of-the-arguments-4c1f';

export const farExpiry = '2099-01-01T00:00:00.000Z';

function orderOf(input: unknown): string {
  return String(Reflect.get(new Object(input), 'order'));
}

function approvalIn(meta: unknown): string | undefined {
  const approval: unknown = Reflect.get(new Object(meta), approvalKey);
  return typeof approval === 'string' ? approval : undefined;
}

function asked(name: string, input: unknown, { request, expiresAt }: Required<ApprovalAsking>): CallToolResult {
  const action = `Pay for order ${orderOf(input)}`;
  return {
    isError: true,
    content: [{ type: 'text', text: `${action} needs the approval of the person the call acts for.` }],
    _meta: {
      [confirmationNeededKey]: {
        request,
        tool: name,
        digest: askedDigest,
        kind: 'pay',
        action,
        site: 'shop.example',
        person: 'person:user_7kLm2',
        expires_at: expiresAt,
      },
    },
  };
}

export function askingForApproval({
  name = 'pay',
  request = 'approval-1',
  expiresAt = farExpiry,
  asksAgain = false,
}: ApprovalAsking = {}): FakeTool {
  const asking = { name, request, expiresAt, asksAgain };
  return {
    name,
    description: 'Pays for an order once the person the call acts for approves it.',
    inputSchema: { type: 'object', properties: { order: { type: 'string' } }, required: [] },
    annotations: { readOnlyHint: false },
    answer: (input, { meta }) => {
      const approval = approvalIn(meta);
      return approval === undefined || asksAgain
        ? asked(name, input, asking)
        : { content: [{ type: 'text', text: `Paid for order ${orderOf(input)} with the approval ${approval}.` }] };
    },
  };
}
