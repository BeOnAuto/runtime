import { cursorOf } from '@on.auto/tool-servers';
import { Effect, Option, Schema } from 'effect';

import type { HeldByPolling } from '../subscriptions/held-subscriptions.ts';
import {
  aRead,
  failureOutcome,
  laterAt,
  type CallFailure,
  type Later,
  type Positioned,
  type Round,
} from '../subscriptions/subscription-retries.ts';
import { checkDueAt, floorMsOf } from './check-pace.ts';
import {
  isNewer,
  listsMore,
  notTakenInJustNow,
  pageOf,
  pagesARoundOf,
  takenIn,
  type Listed,
  type Reading,
} from './checked-pages.ts';

type Ending =
  | { readonly kind: 'done' }
  | { readonly kind: 'cut' }
  | { readonly kind: 'held' }
  | { readonly kind: 'failed'; readonly failure: CallFailure };

interface Walked {
  readonly since: string;
  readonly pageToken: string | null;
  readonly taken: number;
  readonly retryAfterMs: number | null;
  readonly ending: Ending;
}

interface Walk {
  readonly since: string;
  readonly pageToken: string;
  readonly high?: string | undefined;
  readonly taken: number;
  readonly pages: number;
}

type Stepped = { readonly next: Walk } | { readonly walked: Walked };

type Step = (walk: Walk) => Effect.Effect<Stepped>;

function walkedBy(step: Step, first: Walk): Effect.Effect<Walked> {
  return Effect.gen(function* () {
    let stepped = yield* step(first);
    while ('next' in stepped) {
      stepped = yield* step(stepped.next);
    }
    return stepped.walked;
  });
}

const ContinuationSchema = Schema.Struct({ page_token: Schema.String, since: Schema.optionalKey(Schema.String) });

const continuationIn = Schema.decodeUnknownOption(Schema.fromJsonString(ContinuationSchema));

function continuationOf({ pageToken, high }: Pick<Walk, 'pageToken' | 'high'>): string | null {
  return pageToken === '' ? null : JSON.stringify({ page_token: pageToken, since: high });
}

function failedAt({ since, taken }: Walk, failure: CallFailure): Stepped {
  return { walked: { since, pageToken: null, taken, retryAfterMs: null, ending: { kind: 'failed', failure } } };
}

interface Walking {
  readonly reading: Reading;
  readonly most: number;
}

function oldestFirstStep(round: Round, { reading, most }: Walking): Step {
  return (walk) =>
    Effect.gen(function* () {
      const paged = yield* pageOf(round, reading, { since: walk.since, pageToken: '' });
      if ('failure' in paged) {
        return failedAt(walk, paged.failure);
      }
      const fresh = paged.page.listed.filter(({ cursor }) => isNewer(cursor, walk.since));
      const took = yield* takenIn(round, reading, fresh);
      const since = took.through.at(-1)?.cursor ?? walk.since;
      const at = { since, taken: walk.taken + took.taken, pages: walk.pages + 1 };
      const walked = { since, pageToken: null, taken: at.taken, retryAfterMs: paged.page.retryAfterMs };
      if (took.held) {
        return { walked: { ...walked, ending: { kind: 'held' } } };
      }
      if (!listsMore(reading.destination, fresh, paged.page)) {
        return { walked: { ...walked, ending: { kind: 'done' } } };
      }
      return at.pages >= most ? { walked: { ...walked, ending: { kind: 'cut' } } } : { next: { ...walk, ...at } };
    });
}

function newerOf(listed: readonly Listed[], since: string): readonly Listed[] {
  const older = listed.findIndex(({ cursor }) => !isNewer(cursor, since));
  return older === -1 ? listed : listed.slice(0, older);
}

function newestFirstStep(round: Round, { reading, most }: Walking): Step {
  return (walk) =>
    Effect.gen(function* () {
      const paged = yield* pageOf(round, reading, walk);
      if ('failure' in paged) {
        return failedAt(walk, paged.failure);
      }
      const { listed, next, retryAfterMs } = paged.page;
      const newer = newerOf(listed, walk.since);
      const high =
        walk.high ??
        cursorOf(
          'newest_first',
          newer.map(({ cursor }) => cursor),
          null,
        ) ??
        undefined;
      const took = yield* takenIn(round, reading, newer.toReversed());
      const taken = walk.taken + took.taken;
      const stays = { since: walk.since, taken, retryAfterMs };
      if (took.held) {
        return { walked: { ...stays, pageToken: continuationOf(walk), ending: { kind: 'held' } } };
      }
      if (newer.length < listed.length || next === undefined) {
        return { walked: { ...stays, since: high ?? walk.since, pageToken: null, ending: { kind: 'done' } } };
      }
      const onward = { since: walk.since, pageToken: next, high, taken, pages: walk.pages + 1 };
      return onward.pages >= most
        ? { walked: { ...stays, pageToken: continuationOf(onward), ending: { kind: 'cut' } } }
        : { next: onward };
    });
}

function resumedWalk({ made, recorded }: HeldByPolling): Walk {
  const resumed = Option.getOrUndefined(continuationIn(recorded.pageToken ?? ''));
  return { since: made.since, pageToken: resumed?.page_token ?? '', high: resumed?.since, taken: 0, pages: 0 };
}

function positionedAfter(round: Round, held: HeldByPolling, walked: Walked): Effect.Effect<Positioned> {
  const { ending } = walked;
  if (ending.kind === 'failed' || ending.kind === 'held') {
    const failure = ending.kind === 'failed' ? ending.failure : notTakenInJustNow;
    return failureOutcome(round, held, failure, aRead);
  }
  const { destination } = held;
  const dueAt =
    ending.kind === 'done' ? checkDueAt(round, destination, walked.retryAfterMs) : round.now + floorMsOf(destination);
  return Effect.succeed({ positions: { failures: 0, dueAt }, later: laterAt(dueAt) });
}

function markedAfter(round: Round, held: HeldByPolling, walked: Walked): Effect.Effect<Later> {
  const { records } = round.ports;
  const { key, made } = held;
  return Effect.gen(function* () {
    const { positions, later } = yield* positionedAfter(round, held, walked);
    const { since, pageToken } = walked;
    yield* records.marked(round.playbook, key, { since, pageToken, positions }, made.since);
    if (walked.taken > 0 && since !== made.since) {
      yield* records.readThrough(round.playbook, key, since);
    }
    return later;
  });
}

export function readOn(round: Round, held: HeldByPolling): Effect.Effect<Later> {
  const most = { reading: held, most: pagesARoundOf(round) };
  const step =
    held.destination.read.order === 'oldest_first' ? oldestFirstStep(round, most) : newestFirstStep(round, most);
  return Effect.flatMap(walkedBy(step, resumedWalk(held)), (walked) => markedAfter(round, held, walked));
}
