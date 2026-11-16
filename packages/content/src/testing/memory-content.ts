import { Effect } from 'effect';

import { mostContentChunkBytes } from '../content/content-chunks.ts';
import { requireExpected, takenInChunks } from '../content/content-intake.ts';
import { contentPartOf, type AskedRange, type ContentPart } from '../content/content-parts.ts';
import { keptOutside } from '../content/kept-outside.ts';
import type {
  ContentHead,
  ContentHeads,
  ContentOwner,
  ContentStore,
  ErasureTimes,
  ExpiredContent,
  HeadKept,
  HeadMarked,
  HeadToKeep,
  KeptContentHead,
  RecordedContent,
  RemovalTimes,
  StagedContent,
} from '../content/recorded-content.ts';
import type { StreamedContent } from '../content/streamed-content.ts';

interface KeptBytes {
  readonly chunks: Blob;
  readonly mediaType: string;
}

interface MemoryHead extends ExpiredContent {
  readonly head: ContentHead;
  readonly keptAt: number;
  readonly removingSince?: number;
  readonly markedAlone?: boolean;
  readonly expiresAt?: number;
  readonly erasedAt?: number;
}

const noHead: ContentHead = { bytes: 0, mediaType: '' };

export type HeldIn = (owner: ContentOwner, sha256: string) => boolean;

function keyOf({ org }: ContentOwner, sha256: string): string {
  return JSON.stringify([org, sha256]);
}

function placeOf({ org }: ContentOwner): string {
  return `org/${org}/`;
}

function keyAt(place: string, sha256: string): string {
  return JSON.stringify([place, sha256]);
}

function readFrom(kept: KeptBytes | undefined): StreamedContent | undefined {
  return kept === undefined
    ? undefined
    : { stream: kept.chunks.stream(), bytes: kept.chunks.size, mediaType: kept.mediaType };
}

function partFrom(kept: KeptBytes | undefined, asked: AskedRange): ContentPart | undefined {
  return kept === undefined
    ? undefined
    : contentPartOf(kept.chunks.size, kept.mediaType, asked, ({ start, end }) =>
        kept.chunks.slice(start, end + 1).stream(),
      );
}

function stagedIn(kept: Map<string, KeptBytes>, key: string, chunks: Blob): Omit<StagedContent, 'taken'> {
  return {
    placed: (mediaType) =>
      Effect.sync(() => {
        kept.set(key, kept.get(key) ?? { chunks, mediaType });
      }),
    discarded: () => Effect.void,
  };
}

export function memoryContentStore(): ContentStore {
  const kept = new Map<string, KeptBytes>();
  return {
    stage: (place, { stream, expected }) =>
      Effect.gen(function* () {
        const chunks: Readonly<Uint8Array<ArrayBuffer>>[] = [];
        const taken = yield* takenInChunks(stream, mostContentChunkBytes, (chunk) =>
          Effect.sync(() => {
            chunks.push(chunk);
          }),
        );
        yield* requireExpected(expected, taken);
        return { taken, ...stagedIn(kept, keyAt(place, taken.sha256), new Blob(chunks)) };
      }),
    holds: (place, sha256) => Effect.sync(() => kept.has(keyAt(place, sha256))),
    read: (place, sha256) => Effect.sync(() => readFrom(kept.get(keyAt(place, sha256)))),
    readPart: (place, sha256, asked) => Effect.sync(() => partFrom(kept.get(keyAt(place, sha256)), asked)),
    delete: (place, sha256) =>
      Effect.sync(() => {
        kept.delete(keyAt(place, sha256));
      }),
    sweepContent: () => Promise.resolve(),
  };
}

function expiryOf(expiresAt: number | undefined): Pick<MemoryHead, 'expiresAt'> {
  return expiresAt === undefined ? {} : { expiresAt };
}

function erasureOf(erasedAt: number | undefined): Pick<MemoryHead, 'erasedAt'> {
  return erasedAt === undefined ? {} : { erasedAt };
}

function laterExpiry(standing: number | undefined, put: number | undefined): number | undefined {
  return standing === undefined || put === undefined ? undefined : Math.max(standing, put);
}

function standingHead({ owner, sha256, head, keptAt, expiresAt, erasedAt }: MemoryHead): MemoryHead {
  return { owner, sha256, head, keptAt, ...expiryOf(expiresAt), ...erasureOf(erasedAt) };
}

function newHead(content: ExpiredContent, { bytes, mediaType, expiresAt }: HeadToKeep, keptAt: number): MemoryHead {
  return { ...content, head: { bytes, mediaType }, keptAt, ...expiryOf(expiresAt) };
}

function keptOver(heads: Map<string, MemoryHead>, content: ExpiredContent, head: HeadToKeep, keptAt: number): HeadKept {
  const key = keyOf(content.owner, content.sha256);
  const standing = heads.get(key);
  if (standing === undefined || (standing.erasedAt !== undefined && standing.removingSince === undefined)) {
    const kept = newHead(content, head, keptAt);
    heads.set(key, kept);
    return { kept: 'new', head: kept.head };
  }
  return touchedOver(heads, standing, keptAt, head.expiresAt);
}

function touchedOver(
  heads: Map<string, MemoryHead>,
  standing: MemoryHead,
  keptAt: number,
  expiresAt: number | undefined,
): HeadKept {
  if (standing.removingSince !== undefined) {
    return { kept: 'removing', since: standing.removingSince, ...expiryOf(standing.expiresAt) };
  }
  const { owner, sha256, head } = standing;
  heads.set(keyOf(owner, sha256), {
    owner,
    sha256,
    head,
    keptAt,
    ...expiryOf(laterExpiry(standing.expiresAt, expiresAt)),
  });
  return { kept: 'standing', head };
}

function markedOver(standing: MemoryHead | undefined, { before, now, staleBefore }: RemovalTimes): HeadMarked {
  if (standing === undefined) {
    return { marked: true, since: now };
  }
  if (standing.removingSince !== undefined) {
    return standing.removingSince < staleBefore ? { marked: true, since: now } : { marked: false, answer: 'removed' };
  }
  return standing.keptAt < before ? { marked: true, since: now } : { marked: false, answer: 'fresh' };
}

function markedIn(heads: Map<string, MemoryHead>, content: ExpiredContent, times: RemovalTimes): HeadMarked {
  const key = keyOf(content.owner, content.sha256);
  const standing = heads.get(key);
  const marked = markedOver(standing, times);
  if (marked.marked) {
    const marking = standing ?? { ...content, head: noHead, keptAt: 0, markedAlone: true };
    heads.set(key, { ...marking, removingSince: marked.since });
  }
  return marked;
}

function unmarkedIn(heads: Map<string, MemoryHead>, key: string, since: number): void {
  const standing = heads.get(key);
  if (standing?.removingSince !== since) {
    return;
  }
  if (standing.markedAlone === true) {
    heads.delete(key);
    return;
  }
  heads.set(key, standingHead(standing));
}

type Due = readonly [expiresAt: number, content: ExpiredContent];

function dueOf({ owner, sha256, expiresAt, removingSince }: MemoryHead, times: ErasureTimes): readonly Due[] {
  const unmarked = removingSince === undefined || removingSince < times.staleBefore;
  return expiresAt !== undefined && expiresAt <= times.now && unmarked ? [[expiresAt, { owner, sha256 }]] : [];
}

function headRead({ head, keptAt, expiresAt, erasedAt }: MemoryHead): KeptContentHead {
  return { ...head, keptAt, ...expiryOf(expiresAt), ...erasureOf(erasedAt) };
}

function expiredIn(heads: ReadonlyMap<string, MemoryHead>, times: ErasureTimes, most: number): ExpiredContent[] {
  return [...heads.values()]
    .flatMap((standing) => dueOf(standing, times))
    .toSorted(([first], [second]) => first - second)
    .slice(0, most)
    .map(([, content]) => content);
}

function markedSince(heads: Map<string, MemoryHead>, standing: MemoryHead, since: number): number {
  heads.set(keyOf(standing.owner, standing.sha256), { ...standing, removingSince: since });
  return since;
}

function erasingIn(heads: Map<string, MemoryHead>, key: string, times: ErasureTimes): number | undefined {
  const standing = heads.get(key);
  return standing === undefined || dueOf(standing, times).length === 0
    ? undefined
    : markedSince(heads, standing, times.now);
}

function erasedIn(heads: Map<string, MemoryHead>, key: string, since: number): boolean {
  const standing = heads.get(key);
  if (standing?.removingSince !== since) {
    return false;
  }
  const { owner, sha256, head, keptAt } = standing;
  heads.set(key, { owner, sha256, head, keptAt, erasedAt: since });
  return true;
}

function nothingHeld(): boolean {
  return false;
}

interface MemoryShelf {
  readonly heads: Map<string, MemoryHead>;
  readonly places: Map<string, readonly string[]>;
}

function placedIn({ places }: MemoryShelf, key: string, place: string): void {
  const standing = places.get(key) ?? [];
  places.set(key, standing.includes(place) ? standing : [...standing, place]);
}

function clearedIn({ heads, places }: MemoryShelf, key: string, since: number): void {
  if (heads.get(key)?.removingSince === since) {
    heads.delete(key);
    places.delete(key);
  }
}

function erasedWithItsPlaces({ heads, places }: MemoryShelf, key: string, since: number): boolean {
  const recorded = erasedIn(heads, key, since);
  if (recorded) {
    places.delete(key);
  }
  return recorded;
}

export function memoryContentHeads(heldIn: HeldIn = nothingHeld): ContentHeads {
  const shelf: MemoryShelf = { heads: new Map<string, MemoryHead>(), places: new Map<string, readonly string[]>() };
  const { heads, places } = shelf;
  return {
    kept: (owner, sha256, head, keptAt) => Effect.sync(() => keptOver(heads, { owner, sha256 }, head, keptAt)),
    touched: (owner, sha256, keptAt, expiresAt) =>
      Effect.sync(() => {
        const standing = heads.get(keyOf(owner, sha256));
        return standing === undefined || standing.erasedAt !== undefined
          ? undefined
          : touchedOver(heads, standing, keptAt, expiresAt);
      }),
    marked: (owner, sha256, times) =>
      Effect.sync(() =>
        heldIn(owner, sha256) ? { marked: false, answer: 'held' } : markedIn(heads, { owner, sha256 }, times),
      ),
    cleared: (owner, sha256, since) =>
      Effect.sync(() => {
        clearedIn(shelf, keyOf(owner, sha256), since);
      }),
    unmarked: (owner, sha256, since) =>
      Effect.sync(() => {
        unmarkedIn(heads, keyOf(owner, sha256), since);
      }),
    read: (owner, sha256) =>
      Effect.sync(() => {
        const standing = heads.get(keyOf(owner, sha256));
        return standing === undefined || standing.markedAlone === true ? undefined : headRead(standing);
      }),
    expired: (times, most) => Effect.sync(() => expiredIn(heads, times, most)),
    erasing: (owner, sha256, times) => Effect.sync(() => erasingIn(heads, keyOf(owner, sha256), times)),
    erased: (owner, sha256, since) => Effect.sync(() => erasedWithItsPlaces(shelf, keyOf(owner, sha256), since)),
    placeOfNewBytes: placeOf,
    placesOf: (owner, sha256) => Effect.sync(() => places.get(keyOf(owner, sha256)) ?? []),
    placed: (owner, sha256, place) =>
      Effect.sync(() => {
        placedIn(shelf, keyOf(owner, sha256), place);
      }),
  };
}

export function memoryRecordedContent(): RecordedContent {
  return keptOutside(memoryContentHeads(), memoryContentStore()).content;
}
