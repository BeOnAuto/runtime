import type { AskedApproval } from '@on.auto/tool-servers';
import type { ToolReply } from '@on.auto/tool-servers/policy';

import { askedOneAtATime, nobodyMayApprove } from './approval-words.ts';

export type Waiting =
  | { readonly asks: true; readonly person: string }
  | { readonly asks: false; readonly because: string };

export interface PendingApproval {
  readonly callId: string;
  readonly number: number;
  readonly server: string;
  readonly asked: AskedApproval;
  readonly person: string;
  readonly approvedAt: string | null;
}

export interface ApprovedApproval extends PendingApproval {
  readonly approvedAt: string;
}

interface OpenCall {
  readonly number: number;
  readonly server: string;
  readonly call: { readonly callId: string };
}

export interface Approving {
  readonly open: readonly OpenCall[];
  readonly approval: PendingApproval | null;
  readonly waiting: Waiting;
}

export interface TakenAnswer {
  readonly approval: PendingApproval | null;
  readonly reply: ToolReply;
}

function openCallOf(open: readonly OpenCall[], number: number): OpenCall | undefined {
  return open.find((call) => call.number === number);
}

function sentAgain(approval: PendingApproval | null, callId: string | undefined, number: number): boolean {
  return approval !== null && approval.callId === callId && approval.number !== number;
}

export function approvalAfterTheCall({ open, approval }: Approving, number: number): PendingApproval | null {
  return sentAgain(approval, openCallOf(open, number)?.call.callId, number) ? null : approval;
}

type Asking = { readonly refusal: string } | { readonly person: string };

function askingOf(approval: PendingApproval | null, waiting: Waiting, asked: AskedApproval): Asking {
  if (asked.request === null) {
    return { refusal: nobodyMayApprove };
  }
  if (approval !== null) {
    return { refusal: askedOneAtATime };
  }
  return waiting.asks ? { person: waiting.person } : { refusal: waiting.because };
}

export function answerTaken(
  approving: Approving,
  number: number,
  reply: ToolReply,
  asked: AskedApproval | undefined,
): TakenAnswer {
  const open = openCallOf(approving.open, number);
  const approval = approvalAfterTheCall(approving, number);
  if (asked === undefined || open === undefined) {
    return { approval, reply };
  }
  const asking = askingOf(approval, approving.waiting, asked);
  if ('refusal' in asking) {
    return { approval, reply: { text: asking.refusal, isError: true } };
  }
  const { callId } = open.call;
  return { approval: { callId, number, server: open.server, asked, person: asking.person, approvedAt: null }, reply };
}
