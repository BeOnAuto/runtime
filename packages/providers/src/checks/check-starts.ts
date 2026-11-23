import { isBoundedPart } from '@on.auto/operations';
import { Effect } from 'effect';

import type { MadeByPolling } from '../subscriptions/subscription-ports.ts';
import {
  aSubscribe,
  failedOn,
  moved,
  type Acting,
  type CallFailure,
  type Later,
  type Round,
} from '../subscriptions/subscription-retries.ts';
import { renderedPart } from '../subscriptions/subscription-topics.ts';
import { checkDueAt } from './check-pace.ts';
import {
  isNewer,
  listsMore,
  pageOf,
  pagesARoundOf,
  pastWhatARoundReads,
  unreadable,
  type Reading,
} from './checked-pages.ts';

type Started = { readonly since: string; readonly retryAfterMs: number | null } | { readonly failure: CallFailure };

function renderedStart(round: Round, start: string): Effect.Effect<Started> {
  return Effect.map(renderedPart(start, { now: new Date(round.now).toISOString() }), (since): Started =>
    since !== undefined && isBoundedPart(since) ? { since, retryAfterMs: null } : { failure: unreadable },
  );
}

function newestFrom(round: Round, reading: Reading, since: string, pages: number): Effect.Effect<Started> {
  if (pages > pagesARoundOf(round)) {
    return Effect.succeed({ failure: pastWhatARoundReads });
  }
  return Effect.flatMap(pageOf(round, reading, { since, pageToken: '' }), (paged): Effect.Effect<Started> => {
    if ('failure' in paged) {
      return Effect.succeed(paged);
    }
    const { order } = reading.destination.read;
    const fresh = paged.page.listed.filter(({ cursor }) => isNewer(cursor, since));
    const reached = (order === 'oldest_first' ? fresh.at(-1) : fresh.at(0))?.cursor ?? since;
    return order === 'newest_first' || !listsMore(reading.destination, fresh, paged.page)
      ? Effect.succeed({ since: reached, retryAfterMs: paged.page.retryAfterMs })
      : newestFrom(round, reading, reached, pages + 1);
  });
}

function madeFrom(round: Round, calling: Acting & Reading, since: string, retryAfterMs: number | null) {
  const { key, destination, generation } = calling;
  const made: MadeByPolling = { type: 'polling', declared: generation.declared, since };
  const dueAt = checkDueAt(round, destination, retryAfterMs);
  return Effect.andThen(round.ports.records.made(round.playbook, key, made), moved(round, key, { failures: 0, dueAt }));
}

export function startedOn(round: Round, calling: Acting & Reading): Effect.Effect<Later> {
  const { start } = calling.destination.read;
  const starting = start === undefined ? newestFrom(round, calling, '', 1) : renderedStart(round, start);
  return Effect.flatMap(starting, (started) =>
    'failure' in started
      ? failedOn(round, calling, started.failure, aSubscribe)
      : madeFrom(round, calling, started.since, started.retryAfterMs),
  );
}
