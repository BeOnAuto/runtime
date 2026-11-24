import { textAt, valueAt } from '@on.auto/definitions/tool-blocks';
import { stringFormats } from '@on.auto/json-schema';
import { isBoundedPart } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { listedEventOf, listedValueIn, type ArrivalEvent } from '../events/arrival-readings.ts';
import { placesTheMark } from '../events/event-calls.ts';
import { failedBecause } from '../subscriptions/subscription-failed.ts';
import type { SubscriptionKey } from '../subscriptions/subscription-ports.ts';
import type { Polled } from '../subscriptions/subscription-records.ts';
import { placeOf, type CallFailure, type Round } from '../subscriptions/subscription-retries.ts';

export const mostPagesARound = 10;

const isDateTime = stringFormats['date-time'].holds;

const writtenAsANumber = /^-?\d+(?:\.\d+)?$/u;

function orderOf(cursor: string): number | undefined {
  if (writtenAsANumber.test(cursor)) {
    return Number(cursor);
  }
  return isDateTime(cursor) ? Date.parse(cursor) : undefined;
}

export function isNewer(cursor: string, since: string): boolean {
  if (since === '') {
    return true;
  }
  const at = orderOf(cursor);
  const mark = orderOf(since);
  return at === undefined || mark === undefined ? cursor !== since : at > mark;
}

function cursorText(value: unknown): string | undefined {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return typeof text === 'string' && isBoundedPart(text) ? text : undefined;
}

function cursorOfAnItem({ read, events = [] }: Polled, item: Schema.Json): string | undefined {
  if (read.cursor !== undefined) {
    return cursorText(valueAt(item, read.cursor));
  }
  const id = events[0]?.id[0];
  return id === undefined ? undefined : cursorText(listedValueIn(item, id));
}

export interface Listed {
  readonly item: Schema.Json;
  readonly cursor: string;
  readonly event?: ArrivalEvent;
}

export interface Page {
  readonly listed: readonly Listed[];
  readonly next: string | undefined;
  readonly retryAfterMs: number | null;
}

export type Paged = { readonly page: Page } | { readonly failure: CallFailure };

const isAList = Schema.is(Schema.Array(Schema.Json));

const isAnItem = Schema.is(Schema.Record(Schema.String, Schema.Json));

export const unreadable: CallFailure = failedBecause('unreadable');

export const pastWhatARoundReads: CallFailure = failedBecause('too_large');

export const notTakenInJustNow: CallFailure = failedBecause('failing');

type MaybeListed = Pick<Listed, 'item'> & { readonly cursor: string | undefined };

function listedThrough(destination: Polled, list: readonly Schema.Json[]): readonly Listed[] | undefined {
  const listed: readonly MaybeListed[] = list.map((item) => ({ item, cursor: cursorOfAnItem(destination, item) }));
  return listed.every((each: MaybeListed): each is Listed => each.cursor !== undefined) ? listed : undefined;
}

function eventAsListed(destination: Polled, item: Schema.Json): ArrivalEvent | undefined {
  const event = listedEventOf(destination, item);
  return event !== undefined && isAnItem(item) ? { ...event, data: item } : undefined;
}

function isOrdered(destination: Polled, listed: readonly Listed[]): boolean {
  return placesTheMark(destination.read) || listed.every(({ cursor }) => orderOf(cursor) !== undefined);
}

interface MaybeEvented extends Pick<Listed, 'item' | 'cursor'> {
  readonly event: ArrivalEvent | undefined;
}

interface Evented extends Listed {
  readonly event: ArrivalEvent;
}

function listedAsWritten(destination: Polled, list: readonly Schema.Json[]): readonly Listed[] | undefined {
  const listed = listedThrough(destination, list);
  if (listed === undefined || !isOrdered(destination, listed)) {
    return undefined;
  }
  const withEvents: readonly MaybeEvented[] = listed.map(({ item, cursor }) => ({
    item,
    cursor,
    event: eventAsListed(destination, item),
  }));
  return withEvents.every((each: MaybeEvented): each is Evented => each.event !== undefined) ? withEvents : undefined;
}

function listedIn(destination: Polled, list: readonly Schema.Json[]): readonly Listed[] | undefined {
  return destination.writtenInATrigger === true ? listedAsWritten(destination, list) : listedThrough(destination, list);
}

function nextIn(document: Schema.Json | undefined, pointer: string | undefined): string | undefined {
  const next = pointer === undefined ? undefined : textAt(document, pointer);
  return next === '' ? undefined : next;
}

export interface Reading {
  readonly key: SubscriptionKey;
  readonly destination: Polled;
}

export interface Asking {
  readonly since: string;
  readonly pageToken: string;
}

export function pageOf(
  round: Round,
  { key, destination }: Reading,
  { since, pageToken }: Asking,
): Effect.Effect<Paged> {
  const { read } = destination;
  const asked = { read, place: placeOf(round, key), topic: key.topic, since, pageToken };
  return Effect.map(round.calls.read(asked), (done): Paged => {
    if (done.outcome === 'failed') {
      return { failure: { ...done.failure, retryAfterMs: done.retryAfterMs } };
    }
    const list = valueAt(done.document, read.list);
    const listed = isAList(list) ? listedIn(destination, list) : undefined;
    if (listed === undefined) {
      return { failure: unreadable };
    }
    return { page: { listed, next: nextIn(done.document, read.next_page_token), retryAfterMs: done.retryAfterMs } };
  });
}

export function listsMore({ read }: Polled, fresh: readonly Listed[], { next }: Page): boolean {
  return fresh.length > 0 && (read.next_page_token === undefined || next !== undefined);
}

export interface Taking {
  readonly through: readonly Listed[];
  readonly taken: number;
  readonly held: boolean;
}

export function takenIn(round: Round, { key, destination }: Reading, listed: readonly Listed[]): Effect.Effect<Taking> {
  return Effect.gen(function* () {
    const through: Listed[] = [];
    const taken: Listed[] = [];
    for (const each of listed) {
      const event = each.event ?? listedEventOf(destination, each.item);
      const arrival = { playbook: round.playbook, connection: key.connection, topic: key.topic };
      const answer = event === undefined ? 'not_taken' : yield* round.ports.takeIn({ ...arrival, event });
      if (answer === 'held') {
        return { through, taken: taken.length, held: true };
      }
      through.push(each);
      taken.push(...(answer === 'taken' ? [each] : []));
    }
    return { through, taken: taken.length, held: false };
  });
}

export function pagesARoundOf({ ports }: Round): number {
  return ports.pagesARound ?? mostPagesARound;
}
