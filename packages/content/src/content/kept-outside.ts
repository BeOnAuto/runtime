import { Cause, Clock, Effect, Option } from 'effect';

import { mostContentChunkBytes } from './content-chunks.ts';
import { expiryOf, requireABatch } from './content-expiry.ts';
import { requireExpected, takenInChunks } from './content-intake.ts';
import { beingRemoved, type ContentRefused } from './content-refusals.ts';
import type {
  ContentHead,
  ContentHeads,
  ContentKept,
  ContentOwner,
  ContentStore,
  ExpiredErased,
  HeadKept,
  HeadToKeep,
  KeptContentHead,
  RecordedContent,
  UnheldRemoval,
} from './recorded-content.ts';
import type { ContentToKeep } from './streamed-content.ts';

export const removalWaitMs = 5000;

export const removalPollMs = 100;

export const removalLastsMs = 600_000;

export const erasureDeletesWithinMs = removalLastsMs / 2;

export interface KeptOutside {
  readonly content: RecordedContent;
  readonly found: (owner: ContentOwner, sha256: string) => Effect.Effect<boolean>;
  readonly removedKeptBefore: (owner: ContentOwner, sha256: string, before: number) => Effect.Effect<UnheldRemoval>;
  readonly eraseExpired: (most: number) => Effect.Effect<ExpiredErased>;
}

interface Outside {
  readonly heads: ContentHeads;
  readonly store: ContentStore;
}

interface Keeping extends Outside {
  readonly owner: ContentOwner;
  readonly sha256: string;
}

type Removing = Extract<HeadKept, { readonly kept: 'removing' }>;

function isRemoving(asked: HeadKept | undefined): asked is Removing {
  return asked?.kept === 'removing';
}

function readAlone(): Effect.Effect<void> {
  return Effect.void;
}

function keptAs(sha256: string, { bytes, mediaType }: ContentHead): ContentKept {
  return { sha256, bytes, mediaType };
}

function firstAnswerOf<A>(
  places: readonly string[],
  ask: (place: string) => Effect.Effect<A | undefined>,
): Effect.Effect<A | undefined> {
  const [place, ...after] = places;
  return place === undefined
    ? Effect.undefined
    : Effect.flatMap(ask(place), (answer) =>
        answer === undefined ? firstAnswerOf(after, ask) : Effect.succeed(answer),
      );
}

function readAtItsPlaces<A>(
  { heads, owner, sha256 }: Keeping,
  read: (place: string) => Effect.Effect<A | undefined>,
): Effect.Effect<A | undefined> {
  return Effect.flatMap(heads.placesOf(owner, sha256), (places) => firstAnswerOf(places, read));
}

function heldAtAPlace(keeping: Keeping): Effect.Effect<boolean> {
  const { store, sha256 } = keeping;
  const placeHolding = readAtItsPlaces(keeping, (place) =>
    Effect.map(store.holds(place, sha256), (holds) => (holds ? place : undefined)),
  );
  return Effect.map(placeHolding, (place) => place !== undefined);
}

function deletedAtEveryPlace({ heads, store, owner, sha256 }: Keeping): Effect.Effect<void> {
  return Effect.flatMap(heads.placesOf(owner, sha256), (places) =>
    Effect.forEach(places, (place) => store.delete(place, sha256), { discard: true }),
  );
}

function removalFinished(keeping: Keeping, since: number): Effect.Effect<void> {
  const { heads, owner, sha256 } = keeping;
  const deleted = deletedAtEveryPlace(keeping).pipe(Effect.onError(() => heads.unmarked(owner, sha256, since)));
  return Effect.andThen(deleted, heads.cleared(owner, sha256, since));
}

function erasureFinished(keeping: Keeping, since: number): Effect.Effect<boolean> {
  const { heads, owner, sha256 } = keeping;
  return Effect.gen(function* () {
    const left = since + erasureDeletesWithinMs - (yield* Clock.currentTimeMillis);
    if (left <= 0) {
      yield* heads.unmarked(owner, sha256, since);
      return false;
    }
    const deleted = yield* deletedAtEveryPlace(keeping).pipe(
      Effect.onError((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : heads.unmarked(owner, sha256, since))),
      Effect.timeoutOption(left),
    );
    return Option.isSome(deleted) && (yield* heads.erased(owner, sha256, since));
  });
}

function erasedNow(keeping: Keeping): Effect.Effect<boolean> {
  const { heads, owner, sha256 } = keeping;
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const since = yield* heads.erasing(owner, sha256, { now, staleBefore: now - removalLastsMs });
    return since !== undefined && (yield* erasureFinished(keeping, since));
  });
}

function staleMarkFinished(keeping: Keeping, { since, expiresAt }: Removing, now: number): Effect.Effect<boolean> {
  return expiresAt !== undefined && expiresAt <= now
    ? erasedNow(keeping)
    : Effect.as(removalFinished(keeping, since), true);
}

function afterAnyRemoval<Found extends HeadKept | undefined>(
  keeping: Keeping,
  ask: (keptAt: number) => Effect.Effect<Found | Removing>,
  polls: number = removalWaitMs / removalPollMs,
): Effect.Effect<Found, ContentRefused> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const asked = yield* ask(now);
    if (!isRemoving(asked)) {
      return asked;
    }
    if (asked.since < now - removalLastsMs && (yield* staleMarkFinished(keeping, asked, now))) {
      return yield* afterAnyRemoval(keeping, ask, polls);
    }
    if (polls === 0) {
      return yield* Effect.fail(beingRemoved(keeping.sha256));
    }
    yield* Effect.sleep(removalPollMs);
    return yield* afterAnyRemoval(keeping, ask, polls - 1);
  });
}

function heldWhole(
  keeping: Keeping,
  expiresAt: number | undefined,
): Effect.Effect<ContentHead | undefined, ContentRefused> {
  const { heads, owner, sha256 } = keeping;
  return Effect.gen(function* () {
    const touched = yield* afterAnyRemoval(keeping, (keptAt) => heads.touched(owner, sha256, keptAt, expiresAt));
    return touched !== undefined && (yield* heldAtAPlace(keeping)) ? touched.head : undefined;
  });
}

function heldDigestRead(
  { stream, expected }: ContentToKeep,
  head: ContentHead,
): Effect.Effect<ContentKept, ContentRefused> {
  return Effect.gen(function* () {
    const taken = yield* takenInChunks(stream, mostContentChunkBytes, readAlone);
    yield* requireExpected(expected, taken);
    return keptAs(taken.sha256, head);
  });
}

function headToKeep(bytes: number, { mediaType, expiresAt }: ContentToKeep): HeadToKeep {
  return expiresAt === undefined ? { bytes, mediaType } : { bytes, mediaType, expiresAt };
}

function stagedAndPlaced(
  outside: Outside,
  owner: ContentOwner,
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused> {
  const { heads, store } = outside;
  return Effect.gen(function* () {
    const place = heads.placeOfNewBytes(owner);
    const staged = yield* store.stage(place, content);
    const { sha256, bytes } = staged.taken;
    const keeping = { ...outside, owner, sha256 };
    const head = headToKeep(bytes, content);
    const kept = yield* afterAnyRemoval(keeping, (keptAt) => heads.kept(owner, sha256, head, keptAt)).pipe(
      Effect.onError(() => staged.discarded()),
    );
    const bytesStand = kept.kept === 'standing' && (yield* heldAtAPlace(keeping));
    yield* bytesStand
      ? staged.discarded()
      : Effect.andThen(heads.placed(owner, sha256, place), staged.placed(kept.head.mediaType));
    return keptAs(sha256, kept.head);
  });
}

function put(
  outside: Outside,
  owner: ContentOwner,
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused> {
  return Effect.gen(function* () {
    const expiresAt = yield* expiryOf(content);
    const expected = content.expected?.sha256;
    const held =
      expected === undefined ? undefined : yield* heldWhole({ ...outside, owner, sha256: expected }, expiresAt);
    return yield* held === undefined ? stagedAndPlaced(outside, owner, content) : heldDigestRead(content, held);
  });
}

function removedKeptBefore(keeping: Keeping, before: number): Effect.Effect<UnheldRemoval> {
  const { heads, owner, sha256 } = keeping;
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const marked = yield* heads.marked(owner, sha256, { before, now, staleBefore: now - removalLastsMs });
    if (!marked.marked) {
      return marked.answer;
    }
    yield* removalFinished(keeping, marked.since);
    return 'removed';
  });
}

function expiredErased(outside: Outside, most: number): Effect.Effect<ExpiredErased> {
  return Effect.gen(function* () {
    yield* requireABatch(most);
    const now = yield* Clock.currentTimeMillis;
    const expired = yield* outside.heads.expired({ now, staleBefore: now - removalLastsMs }, most);
    const erasures = yield* Effect.forEach(expired, ({ owner, sha256 }) => erasedNow({ ...outside, owner, sha256 }));
    return { erased: erasures.filter(Boolean).length, more: expired.length === most };
  });
}

interface Resolved<A> {
  readonly erased: Effect.Effect<A>;
  readonly stored: (head: KeptContentHead | undefined) => Effect.Effect<A>;
}

function resolvedThroughItsHead<A>(
  { heads }: Outside,
  owner: ContentOwner,
  sha256: string,
  { erased, stored }: Resolved<A>,
): Effect.Effect<A> {
  return Effect.flatMap(heads.read(owner, sha256), (head) => (head?.erasedAt === undefined ? stored(head) : erased));
}

function readAsHeld<Read extends { readonly mediaType: string }>(
  keeping: Keeping,
  readAt: (place: string) => Effect.Effect<Read | undefined>,
): Effect.Effect<Read | undefined> {
  return resolvedThroughItsHead(keeping, keeping.owner, keeping.sha256, {
    erased: Effect.undefined,
    stored: (head) =>
      Effect.map(readAtItsPlaces(keeping, readAt), (read) =>
        read === undefined ? read : { ...read, mediaType: head?.mediaType ?? read.mediaType },
      ),
  });
}

function foundAsRead(keeping: Keeping): Effect.Effect<boolean> {
  return resolvedThroughItsHead(keeping, keeping.owner, keeping.sha256, {
    erased: Effect.succeed(true),
    stored: () => heldAtAPlace(keeping),
  });
}

export function keptOutside(heads: ContentHeads, store: ContentStore): KeptOutside {
  const outside: Outside = { heads, store };
  return {
    content: {
      put: (owner, content) => put(outside, owner, content),
      get: (owner, sha256) => readAsHeld({ ...outside, owner, sha256 }, (place) => store.read(place, sha256)),
      getHead: (owner, sha256) => heads.read(owner, sha256),
      getPart: (owner, sha256, asked) =>
        readAsHeld({ ...outside, owner, sha256 }, (place) => store.readPart(place, sha256, asked)),
    },
    found: (owner, sha256) => foundAsRead({ ...outside, owner, sha256 }),
    removedKeptBefore: (owner, sha256, before) => removedKeptBefore({ ...outside, owner, sha256 }, before),
    eraseExpired: (most) => expiredErased(outside, most),
  };
}
