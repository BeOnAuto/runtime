import { Buffer } from 'node:buffer';

import type { Issue } from '@on.auto/operations';
import type { Schema } from 'effect';

import type { ReplyRefusal } from '../facts/run-facts.ts';
import { answerIssuesOf } from '../requests/answer-check.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import { interactionBounds } from '../run/run-bounds.ts';
import { answerOfReply, type ReplyRule } from './reply-rule.ts';

interface SentMessage {
  readonly conversation: string;
  readonly id: string;
}

export interface KeptRequest {
  readonly runId: string;
  readonly row: OpenRequestRow;
  readonly sent: SentMessage;
  readonly rule: ReplyRule;
  readonly answerSchema: Schema.JsonObject;
}

export interface Reply {
  readonly id: string;
  readonly sender: string;
  readonly text: string | undefined;
  readonly to: string | undefined;
}

export type ReplyDecision =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'take'; readonly request: KeptRequest; readonly answer: Schema.Json }
  | {
      readonly kind: 'refuse';
      readonly request: KeptRequest;
      readonly because: ReplyRefusal;
      readonly issues: readonly Issue[];
    };

const nothing: ReplyDecision = { kind: 'nothing' };

interface Belonging {
  readonly request: KeptRequest | undefined;
  readonly ambiguous: boolean;
}

function belongingOf({ to }: Reply, kept: readonly KeptRequest[]): Belonging {
  if (to !== undefined) {
    return { request: kept.find(({ sent }) => sent.id === to), ambiguous: false };
  }
  return { request: kept.at(-1), ambiguous: kept.length > 1 };
}

function refused(request: KeptRequest, because: ReplyRefusal, issues: readonly Issue[] = []): ReplyDecision {
  return { kind: 'refuse', request, because, issues };
}

function answeredBy(request: KeptRequest, words: string): ReplyDecision {
  if (Buffer.byteLength(words, 'utf8') > interactionBounds.messageBytes) {
    return refused(request, 'too_long');
  }
  const answer = answerOfReply(request.rule, words);
  if (answer === undefined) {
    return refused(request, 'not_an_answer');
  }
  const issues = answerIssuesOf(answer, request.answerSchema);
  return issues.length === 0 ? { kind: 'take', request, answer } : refused(request, 'invalid', issues);
}

export function decisionOf(reply: Reply, kept: readonly KeptRequest[], answered: ReadonlySet<string>): ReplyDecision {
  const { request, ambiguous } = belongingOf(reply, kept);
  if (request === undefined || request.row.answerer !== reply.sender || answered.has(request.runId)) {
    return nothing;
  }
  if (ambiguous) {
    return refused(request, 'ambiguous');
  }
  return answeredBy(request, reply.text ?? '');
}
