import { Buffer } from 'node:buffer';

import { textAt, valueAt } from '@on.auto/definitions/tool-blocks';
import {
  answerDocument,
  toolBounds,
  type CallAnswered,
  type CalledOnce,
  type ReadingFailedBecause,
} from '@on.auto/tool-servers';

import { isBoundedPart } from '../delivery/sent-messages.ts';
import type { Reply } from '../replies/reply-taking.ts';
import type { Replies } from '../tool-blocks/tool-block-schemas.ts';

type ReplyPointers = Replies['read']['each'];

interface ReadOf {
  readonly replies: readonly Reply[];
  readonly ids: readonly string[];
  readonly considered: number;
  readonly retryAfterMs: number | null;
  readonly failure: string | null;
}

export type ReadAnswer =
  | (ReadOf & { readonly outcome: 'result'; readonly answered: CallAnswered })
  | (ReadOf & { readonly outcome: ReadingFailedBecause });

export function cursorOf(order: Replies['read']['order'], ids: readonly string[], prior: string | null): string | null {
  return (order === 'oldest_first' ? ids.at(-1) : ids.at(0)) ?? prior;
}

export function failedRead(outcome: ReadingFailedBecause, detail = '', retryAfterMs: number | null = null): ReadAnswer {
  const failure = detail === '' ? outcome : `${outcome}: ${detail}`;
  return { outcome, replies: [], ids: [], considered: 0, retryAfterMs, failure };
}

function idOf(item: unknown, each: ReplyPointers): readonly string[] {
  const id = textAt(item, each.id);
  return id !== undefined && isBoundedPart(id) ? [id] : [];
}

function replyOf(item: unknown, each: ReplyPointers): readonly Reply[] {
  const id = textAt(item, each.id);
  const sender = textAt(item, each.sender);
  if (id === undefined || sender === undefined || !isBoundedPart(id) || !isBoundedPart(sender)) {
    return [];
  }
  return [{ id, sender, text: textAt(item, each.text), to: each.to === undefined ? undefined : textAt(item, each.to) }];
}

export interface PassedOver {
  readonly sent: ReadonlySet<string>;
  readonly automatic: string | undefined;
}

function isPassedOver(item: unknown, each: ReplyPointers, { sent, automatic }: PassedOver): boolean {
  const postedByAnApp = automatic !== undefined && (valueAt(item, automatic) ?? null) !== null;
  return postedByAnApp || idOf(item, each).some((id) => sent.has(id));
}

function listed(replies: Replies, document: unknown, answered: CallAnswered, passed: PassedOver): ReadAnswer {
  const list = valueAt(document, replies.read.list);
  if (!Array.isArray(list)) {
    return failedRead('unreadable');
  }
  const { each } = replies.read;
  const others = list.filter((item: unknown) => !isPassedOver(item, each, passed));
  return {
    outcome: 'result',
    answered,
    replies: others.flatMap((item: unknown) => replyOf(item, each)),
    ids: list.flatMap((item: unknown) => idOf(item, each)),
    considered: others.length,
    retryAfterMs: null,
    failure: null,
  };
}

export function readAnswerOf(replies: Replies, called: CalledOnce, passed: PassedOver): ReadAnswer {
  if (called.kind === 'unopened') {
    return failedRead(called.refused === 'tool_not_offered' ? 'tool_not_offered' : 'server_failure', called.detail);
  }
  if (called.outcome !== 'result') {
    return failedRead(called.outcome, called.detail, called.retryAfterMs);
  }
  const document = answerDocument(called.answer);
  if (document === undefined) {
    return failedRead('unreadable');
  }
  return Buffer.byteLength(JSON.stringify(document), 'utf8') > toolBounds.readAnswerBytes
    ? failedRead('too_large')
    : listed(replies, document, called.answered, passed);
}
