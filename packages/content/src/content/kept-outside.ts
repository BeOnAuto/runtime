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
  readonly removedKeptBefore: (playbook: ContentOwner, sha256: string, before: number) => Effect.Effect<UnheldRemoval>;
  readonly eraseExpired: (most: number) => Effect.Effect<ExpiredErased>;
}

interface Outside {
  readonly heads: ContentHeads;
  readonly store: ContentStore;
}

interface Keeping extends Outside {
  readonly playbook: ContentOwner;
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

function removalFinished({ heads, store, playbook, sha256 }: Keeping, since: number): Effect.Effect<void> {
  const deleted = store.delete(playbook, sha256).pipe(Effect.onError(() => heads.unmarked(playbook, sha256, since)));
  return Effect.andThen(deleted, heads.cleared(playbook, sha256, since));
}

function erasureFinished(keeping: Keeping, since: number): Effect.Effect<boolean> {
  const { heads, store, playbook, sha256 } = keeping;
  return Effect.gen(function* () {
    const left = since + erasureDeletesWithinMs - (yield* Clock.currentTimeMillis);
    if (left <= 0) {
      yield* heads.unmarked(playbook, sha256, since);
      return false;
    }
    const deleted = yield* store.delete(playbook, sha256).pipe(
      Effect.onError((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : heads.unmarked(playbook, sha256, since),
      ),
      Effect.timeoutOption(left),
    );
    return Option.isSome(deleted) && (yield* heads.erased(playbook, sha256, since));
  });
}

function erasedNow(keeping: Keeping): Effect.Effect<boolean> {
  const { heads, playbook, sha256 } = keeping;
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const since = yield* heads.erasing(playbook, sha256, { now, staleBefore: now - removalLastsMs });
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
  const { heads, store, playbook, sha256 } = keeping;
  return Effect.gen(function* () {
    const touched = yield* afterAnyRemoval(keeping, (keptAt) => heads.touched(playbook, sha256, keptAt, expiresAt));
    return touched !== undefined && (yield* store.holds(playbook, sha256)) ? touched.head : undefined;
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
  playbook: ContentOwner,
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused> {
  const { heads, store } = outside;
  return Effect.gen(function* () {
    const staged = yield* store.stage(playbook, content);
    const { sha256, bytes } = staged.taken;
    const head = headToKeep(bytes, content);
    const kept = yield* afterAnyRemoval({ ...outside, playbook, sha256 }, (keptAt) =>
      heads.kept(playbook, sha256, head, keptAt),
    ).pipe(Effect.onError(() => staged.discarded()));
    const bytesStand = kept.kept === 'standing' && (yield* store.holds(playbook, sha256));
    yield* bytesStand ? staged.discarded() : staged.placed(kept.head.mediaType);
    return keptAs(sha256, kept.head);
  });
}

function put(
  outside: Outside,
  playbook: ContentOwner,
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused> {
  return Effect.gen(function* () {
    const expiresAt = yield* expiryOf(content);
    const expected = content.expected?.sha256;
    const held =
      expected === undefined ? undefined : yield* heldWhole({ ...outside, playbook, sha256: expected }, expiresAt);
    return yield* held === undefined ? stagedAndPlaced(outside, playbook, content) : heldDigestRead(content, held);
  });
}

function removedKeptBefore(keeping: Keeping, before: number): Effect.Effect<UnheldRemoval> {
  const { heads, playbook, sha256 } = keeping;
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const marked = yield* heads.marked(playbook, sha256, { before, now, staleBefore: now - removalLastsMs });
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
    const erasures = yield* Effect.forEach(expired, ({ playbook, sha256 }) =>
      erasedNow({ ...outside, playbook, sha256 }),
    );
    return { erased: erasures.filter(Boolean).length, more: expired.length === most };
  });
}

function readAsHeld<Read extends { readonly mediaType: string }>(
  { heads }: Outside,
  playbook: ContentOwner,
  sha256: string,
  stored: Effect.Effect<Read | undefined>,
): Effect.Effect<Read | undefined> {
  return Effect.flatMap(heads.read(playbook, sha256), (head) =>
    head?.erasedAt === undefined
      ? Effect.map(stored, (read) =>
          read === undefined ? read : { ...read, mediaType: head?.mediaType ?? read.mediaType },
        )
      : Effect.undefined,
  );
}

export function keptOutside(heads: ContentHeads, store: ContentStore): KeptOutside {
  const outside: Outside = { heads, store };
  return {
    content: {
      put: (playbook, content) => put(outside, playbook, content),
      get: (playbook, sha256) => readAsHeld(outside, playbook, sha256, store.read(playbook, sha256)),
      getHead: (playbook, sha256) => heads.read(playbook, sha256),
      getPart: (playbook, sha256, asked) =>
        readAsHeld(outside, playbook, sha256, store.readPart(playbook, sha256, asked)),
    },
    removedKeptBefore: (playbook, sha256, before) => removedKeptBefore({ ...outside, playbook, sha256 }, before),
    eraseExpired: (most) => expiredErased(outside, most),
  };
}
