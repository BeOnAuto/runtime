import { Buffer } from 'node:buffer';

import { signedInPersonPrefix, type Issue, type PlaybookAddress, type ProjectedAddress } from '@on.auto/operations';
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
  readonly playbook: PlaybookAddress;
  readonly address: ProjectedAddress;
  readonly runId: string;
  readonly row: OpenRequestRow;
  readonly sent: SentMessage;
  readonly reading: string;
  readonly rule: ReplyRule;
  readonly answerSchema: Schema.JsonObject;
}

export interface Reply {
  readonly id: string;
  readonly sender: string;
  readonly text: string | undefined;
  readonly to: string | undefined;
  readonly olderThan: readonly string[];
  readonly time?: number;
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
  readonly askedBefore: readonly KeptRequest[];
}

function writtenBefore({ olderThan, time }: Reply, { sent, row }: KeptRequest): boolean {
  return olderThan.includes(sent.id) || (time !== undefined && time < row.requested_at);
}

function belongingOf(reply: Reply, kept: readonly KeptRequest[]): Belonging {
  const { to } = reply;
  if (to !== undefined) {
    return { request: kept.find(({ sent }) => sent.id === to), ambiguous: false, askedBefore: kept };
  }
  const askedBefore = kept.filter((request) => !writtenBefore(reply, request));
  return { request: askedBefore.at(-1), ambiguous: askedBefore.length > 1, askedBefore };
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

function namesAPerson(party: string): boolean {
  return party.startsWith(signedInPersonPrefix) || party.includes('@');
}

function answeredByTheRoom({ row }: KeptRequest): boolean {
  return row.answerer === row.party && !namesAPerson(row.party);
}

interface Replier {
  readonly sender: string;
  readonly to: string | undefined;
}

export function mayAnswer(request: KeptRequest, { sender, to }: Replier): boolean {
  return request.row.answerer === sender || (to === request.sent.id && answeredByTheRoom(request));
}

function answersOneOf(kept: readonly KeptRequest[], reply: Reply): boolean {
  return kept.some((request) => mayAnswer(request, reply));
}

function fromAnother(request: KeptRequest, reply: Reply, others: readonly KeptRequest[]): ReplyDecision {
  const takenFromTheAnswerer = answeredBy(request, reply.text ?? '').kind === 'take';
  return takenFromTheAnswerer && !answersOneOf(others, reply) ? refused(request, 'not_the_answerer') : nothing;
}

export function decisionOf(reply: Reply, kept: readonly KeptRequest[]): ReplyDecision {
  const { request, ambiguous, askedBefore } = belongingOf(reply, kept);
  if (request === undefined) {
    return nothing;
  }
  if (!mayAnswer(request, reply)) {
    return fromAnother(request, reply, ambiguous ? askedBefore : []);
  }
  if (ambiguous) {
    return refused(request, 'ambiguous');
  }
  return answeredBy(request, reply.text ?? '');
}
