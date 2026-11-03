import { Clock, Effect } from 'effect';

import { mostContentChunkBytes } from './content-chunks.ts';
import { requireExpected, takenInChunks } from './content-intake.ts';
import { beingRemoved, type ContentRefused } from './content-refusals.ts';
import type {
  ContentHead,
  ContentHeads,
  ContentKept,
  ContentOwner,
  ContentStore,
  HeadKept,
  RecordedContent,
  UnheldRemoval,
} from './recorded-content.ts';
import type { ContentToKeep } from './streamed-content.ts';

export const removalWaitMs = 5000;

export const removalPollMs = 100;

export const removalLastsMs = 600_000;

export interface KeptOutside {
  readonly content: RecordedContent;
  readonly removedKeptBefore: (playbook: ContentOwner, sha256: string, before: number) => Effect.Effect<UnheldRemoval>;
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

function removalFinished({ heads, store, playbook, sha256 }: Keeping, since: number): Effect.Effect<void> {
  const deleted = store.delete(playbook, sha256).pipe(Effect.onError(() => heads.unmarked(playbook, sha256, since)));
  return Effect.andThen(deleted, heads.cleared(playbook, sha256, since));
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
    if (asked.since < now - removalLastsMs) {
      yield* removalFinished(keeping, asked.since);
      return yield* afterAnyRemoval(keeping, ask, polls);
    }
    if (polls === 0) {
      return yield* Effect.fail(beingRemoved(keeping.sha256));
    }
    yield* Effect.sleep(removalPollMs);
    return yield* afterAnyRemoval(keeping, ask, polls - 1);
  });
}

function heldWhole(keeping: Keeping): Effect.Effect<ContentHead | undefined, ContentRefused> {
  const { heads, store, playbook, sha256 } = keeping;
  return Effect.gen(function* () {
    const touched = yield* afterAnyRemoval(keeping, (keptAt) => heads.touched(playbook, sha256, keptAt));
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
    return { sha256: taken.sha256, ...head };
  });
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
    const head = { bytes, mediaType: content.mediaType };
    const kept = yield* afterAnyRemoval({ ...outside, playbook, sha256 }, (keptAt) =>
      heads.kept(playbook, sha256, head, keptAt),
    ).pipe(Effect.onError(() => staged.discarded()));
    const bytesStand = kept.kept === 'standing' && (yield* store.holds(playbook, sha256));
    yield* bytesStand ? staged.discarded() : staged.placed(kept.head.mediaType);
    return { sha256, ...kept.head };
  });
}

function put(
  outside: Outside,
  playbook: ContentOwner,
  content: ContentToKeep,
): Effect.Effect<ContentKept, ContentRefused> {
  return Effect.gen(function* () {
    const expected = content.expected?.sha256;
    const held = expected === undefined ? undefined : yield* heldWhole({ ...outside, playbook, sha256: expected });
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

function readAsHeld<Read extends { readonly mediaType: string }>(
  { heads }: Outside,
  playbook: ContentOwner,
  sha256: string,
  stored: Effect.Effect<Read | undefined>,
): Effect.Effect<Read | undefined> {
  return Effect.zipWith(heads.read(playbook, sha256), stored, (head, read) =>
    read === undefined ? read : { ...read, mediaType: head?.mediaType ?? read.mediaType },
  );
}

export function keptOutside(heads: ContentHeads, store: ContentStore): KeptOutside {
  const outside: Outside = { heads, store };
  return {
    content: {
      put: (playbook, content) => put(outside, playbook, content),
      get: (playbook, sha256) => readAsHeld(outside, playbook, sha256, store.read(playbook, sha256)),
      getPart: (playbook, sha256, asked) =>
        readAsHeld(outside, playbook, sha256, store.readPart(playbook, sha256, asked)),
    },
    removedKeptBefore: (playbook, sha256, before) => removedKeptBefore({ ...outside, playbook, sha256 }, before),
  };
}
