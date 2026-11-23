import { Buffer } from 'node:buffer';

import { textAt, valueAt } from '@on.auto/definitions/tool-blocks';
import { isBoundedPart } from '@on.auto/operations';
import {
  answerDocument,
  cursorOf,
  toolBounds,
  type CallAnswered,
  type CalledOnce,
  type ReadingFailedBecause,
  type UnopenedOnce,
} from '@on.auto/tool-servers';

import type { Reply } from '../replies/reply-taking.ts';
import { writtenAtMs } from '../replies/written-times.ts';
import { readsVariable } from '../tool-blocks/rendered-reads.ts';
import type { Replies } from '../tool-blocks/tool-block-schemas.ts';

type ReplyPointers = Replies['read']['each'];

interface ReadOf {
  readonly replies: readonly Reply[];
  readonly ids: readonly string[];
  readonly considered: number;
  readonly retryAfterMs: number | null;
  readonly failure: string | null;
  readonly detail?: string;
}

export type ReadAnswer =
  | (ReadOf & { readonly outcome: 'result'; readonly answered: CallAnswered })
  | (ReadOf & { readonly outcome: ReadingFailedBecause });

export function cursorAfter({ read }: Pick<Replies, 'read'>, { ids }: ReadAnswer, prior: string | null) {
  return cursorOf(read.order, ids, prior);
}

export function failedRead(outcome: ReadingFailedBecause, detail = '', retryAfterMs: number | null = null): ReadAnswer {
  const failure = detail === '' ? outcome : `${outcome}: ${detail}`;
  return { outcome, replies: [], ids: [], considered: 0, retryAfterMs, failure };
}

function idOf(item: unknown, each: ReplyPointers): readonly string[] {
  const id = textAt(item, each.id);
  return id !== undefined && isBoundedPart(id) ? [id] : [];
}

interface Listed {
  readonly item: unknown;
  readonly olderThan: readonly string[];
}

function writtenOf(item: unknown, { time }: ReplyPointers, readAt: number): Pick<Reply, 'time'> | undefined {
  if (time === undefined) {
    return {};
  }
  const writtenAt = writtenAtMs(valueAt(item, time), readAt);
  return writtenAt === undefined ? undefined : { time: writtenAt };
}

function replyOf({ item, olderThan }: Listed, each: ReplyPointers, readAt: number): readonly Reply[] {
  const id = textAt(item, each.id);
  const sender = textAt(item, each.sender);
  const written = writtenOf(item, each, readAt);
  if (
    id === undefined ||
    sender === undefined ||
    !isBoundedPart(id) ||
    !isBoundedPart(sender) ||
    written === undefined
  ) {
    return [];
  }
  const to = each.to === undefined ? undefined : textAt(item, each.to);
  return [{ id, sender, text: textAt(item, each.text), to, olderThan, ...written }];
}

export interface PassedOver {
  readonly sent: ReadonlySet<string>;
  readonly automatic: string | undefined;
  readonly fromTheFirstMessage: boolean;
  readonly ended: ReadonlySet<string>;
  readonly readAt: number;
}

interface ReadStart {
  readonly since: string | null;
  readonly namesItsMessage: boolean;
}

export function listsFromTheFirstMessage(
  replies: Pick<Replies, 'with' | 'read'>,
  { since, namesItsMessage }: ReadStart,
) {
  const fromTheToolsStart = (since ?? '') === '' || !readsVariable(replies.with, 'since');
  return replies.read.order === 'oldest_first' && !namesItsMessage && fromTheToolsStart;
}

function isPassedOver(item: unknown, each: ReplyPointers, { sent, automatic }: PassedOver): boolean {
  const postedByAnApp = automatic !== undefined && (valueAt(item, automatic) ?? null) !== null;
  return postedByAnApp || idOf(item, each).some((id) => sent.has(id));
}

interface Listing {
  readonly each: ReplyPointers;
  readonly sent: ReadonlySet<string>;
  readonly beyondThePage: readonly string[];
}

function listedFromTheNewest(newestFirst: readonly unknown[], { each, sent, beyondThePage }: Listing) {
  const newer = [...beyondThePage];
  return newestFirst.map((item): Listed => {
    const olderThan = [...newer];
    newer.push(...idOf(item, each).filter((id) => sent.has(id)));
    return { item, olderThan };
  });
}

function unlistedOf(ids: readonly string[], sent: ReadonlySet<string>): readonly string[] {
  return [...sent].filter((id) => !ids.includes(id));
}

function listedOf(
  list: readonly unknown[],
  ids: readonly string[],
  { each, order }: Replies['read'],
  passed: PassedOver,
) {
  const { sent, ended, fromTheFirstMessage } = passed;
  if (order === 'newest_first') {
    return listedFromTheNewest(list, { each, sent, beyondThePage: [] });
  }
  const listsARequestsMessage = ids.some((id) => sent.has(id) || ended.has(id));
  const beyondThePage = fromTheFirstMessage && listsARequestsMessage ? unlistedOf(ids, sent) : [];
  return listedFromTheNewest(list.toReversed(), { each, sent, beyondThePage }).toReversed();
}

const noTimeWords =
  'No message the read listed holds a time each.time can read; it takes RFC 3339 text such as 2026-10-05T09:00:00Z, or seconds since the epoch';

function holdsNoTime(list: readonly unknown[], { time }: ReplyPointers, readAt: number): boolean {
  return (
    time !== undefined &&
    list.length > 0 &&
    list.every((item: unknown) => writtenAtMs(valueAt(item, time), readAt) === undefined)
  );
}

function listed(replies: Replies, document: unknown, answered: CallAnswered, passed: PassedOver): ReadAnswer {
  const list = valueAt(document, replies.read.list);
  if (!Array.isArray(list)) {
    return failedRead('unreadable');
  }
  const { each } = replies.read;
  if (holdsNoTime(list, each, passed.readAt)) {
    return { ...failedRead('unreadable', noTimeWords), detail: noTimeWords };
  }
  const ids = list.flatMap((item: unknown) => idOf(item, each));
  const others = listedOf(list, ids, replies.read, passed).filter(({ item }) => !isPassedOver(item, each, passed));
  return {
    outcome: 'result',
    answered,
    replies: others.flatMap((one) => replyOf(one, each, passed.readAt)),
    ids,
    considered: others.length,
    retryAfterMs: null,
    failure: null,
  };
}

const unopenedBecause: Readonly<Record<UnopenedOnce['refused'], ReadingFailedBecause>> = {
  tool_not_offered: 'tool_not_offered',
  tool_server_failed: 'server_failure',
  tool_not_read_only: 'server_failure',
  asset_not_sent: 'arguments_refused',
};

export function readAnswerOf(replies: Replies, called: CalledOnce, passed: PassedOver): ReadAnswer {
  if (called.kind === 'unopened') {
    return failedRead(unopenedBecause[called.refused], called.detail);
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
