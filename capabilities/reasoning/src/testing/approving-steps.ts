import { memoryRecordedContent } from '@on.auto/content/testing';
import { Effect, Option } from 'effect';

import { approvalRequestOf } from '../approvals/approval-requests.ts';
import type { PendingApproval } from '../approvals/pending-approvals.ts';
import type { ToolCallAnswer, ToolCallJob } from '../jobs/jobs.ts';
import { keptIn } from '../steps/kept-content.ts';
import type { Stepped } from '../steps/step-loop.ts';
import { textResult, toolCallsResult } from './model-results.ts';
import { answers, type ScriptedReply } from './scripted-language-model.ts';
import { stepsOf, toolOf, type StepsOptions } from './step-runs.ts';

type Content = NonNullable<StepsOptions['content']>;

type Attempt = NonNullable<StepsOptions['before']>;

export type Answer = NonNullable<Attempt['request']>['answer'];

export type Asked = NonNullable<ToolCallAnswer['asked']>;

export type ApprovalSteps = NonNullable<StepsOptions['approvals']>;

export const pay = toolOf('shop', 'pay', false);

export const search = toolOf('graph', 'search');

export const priya = 'person:user_7kLm2';

export const asked: Asked = {
  request: 'approval-1',
  tool: 'pay',
  digest: 'sha256-of-the-arguments',
  action: 'Pay for order A-17',
  expires_at: '2099-01-01T00:00:00.000Z',
};

export const askingPriya: ApprovalSteps = {
  waiting: { asks: true, person: priya },
  signed: ({ person }, { callId }) => Effect.succeed(`signed by ${person} for ${callId}`),
};

export interface ShopAnswering {
  readonly asksAgain?: boolean;
  readonly fails?: boolean;
  readonly asking?: Asked;
}

function kept(content: Content, text: string, isError: boolean, more: Partial<ToolCallAnswer> = {}) {
  const result = JSON.stringify({ content: [{ type: 'text', text }] });
  return Effect.map(keptIn(content, { org: 'acme', playbook: 'alpha' }).keep(result), ({ sha256, bytes }) => ({
    ended: {
      type: 'tool_call_answered' as const,
      data: { is_error: isError, result_bytes: bytes, result_sha256: sha256, duration_ms: 1, jsonrpc_id: 1 },
    },
    reply: { text, isError },
    ...more,
  }));
}

const notAnswered: ToolCallAnswer = {
  ended: {
    type: 'tool_call_failed',
    data: { because: 'timed_out', detail: 'The server did not answer', duration_ms: 30_000, jsonrpc_id: 1 },
  },
  reply: { text: 'The shop server did not answer in time.', isError: true },
};

export function shop(content: Content, { asksAgain = false, fails = false, asking = asked }: ShopAnswering = {}) {
  return (job: ToolCallJob): Effect.Effect<ToolCallAnswer> => {
    if (job.tool !== 'shop__pay') {
      return kept(content, 'Found 2 rows.', false);
    }
    if (job.approval === undefined || asksAgain) {
      return kept(content, 'Paying needs approval.', true, { asked: asking });
    }
    return fails ? Effect.succeed(notAnswered) : kept(content, `Paid with ${job.approval}.`, false);
  };
}

export const payingForA17: ScriptedReply = answers(toolCallsResult([['shop__pay', { order: 'A-17' }]]));

export function firstAsking(content: Content, steps: Partial<StepsOptions> = {}) {
  return stepsOf({
    tools: [pay, search],
    content,
    approvals: askingPriya,
    send: shop(content),
    replies: [payingForA17],
    ...steps,
  });
}

type Ending = Stepped['ending'];

function waitsForAnApproval(ending: Ending): ending is Extract<Ending, { readonly type: 'approval' }> {
  return ending.type === 'approval';
}

export function approvalIn({ ending }: Stepped): PendingApproval {
  return Option.getOrThrow(Option.liftPredicate(ending, waitsForAnApproval)).approval;
}

export function answerBy(answer: NonNullable<Answer>['answer']): Answer {
  return { answer, by: { id: priya, name: 'Priya Shah' }, at: '2026-11-05T10:01:00.000Z' };
}

async function askedOnce() {
  const content = memoryRecordedContent();
  const first = firstAsking(content);
  const stepped = await Effect.runPromise(first.stepping);
  const record = approvalRequestOf({
    person: priya,
    at: Date.now(),
    functionName: 'pay-supplier',
    approval: approvalIn(stepped),
    numbering: stepped.state.facts.numbering,
    spent: undefined,
  });
  return { content, first, record };
}

export async function wentOnAfter(answer: Answer, more: Partial<StepsOptions> = {}, answering: ShopAnswering = {}) {
  const { content, first, record } = await askedOnce();
  const before: Attempt = {
    startedAt: new Date().toISOString(),
    modelCallsBefore: 0,
    calls: first.journal.calls(),
    requests: 1,
    request: { record, at: new Date().toISOString(), answer },
  };
  const second = stepsOf({
    tools: [pay, search],
    content,
    approvals: askingPriya,
    send: shop(content, answering),
    before,
    replies: [answers(textResult('Done.'))],
    ...more,
  });
  return { stepped: await Effect.runPromise(second.stepping), second, before, content };
}

export function lastToolAnswersIn(requests: () => readonly { readonly conversation?: readonly unknown[] }[]): string {
  return JSON.stringify(requests().at(-1)?.conversation?.at(-1));
}
