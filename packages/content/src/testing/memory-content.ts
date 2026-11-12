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

export type HeldIn = (playbook: ContentOwner, sha256: string) => boolean;

function keyOf({ org, playbook }: ContentOwner, sha256: string): string {
  return JSON.stringify([org, playbook, sha256]);
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
    stage: (playbook, { stream, expected }) =>
      Effect.gen(function* () {
        const chunks: Readonly<Uint8Array<ArrayBuffer>>[] = [];
        const taken = yield* takenInChunks(stream, mostContentChunkBytes, (chunk) =>
          Effect.sync(() => {
            chunks.push(chunk);
          }),
        );
        yield* requireExpected(expected, taken);
        return { taken, ...stagedIn(kept, keyOf(playbook, taken.sha256), new Blob(chunks)) };
      }),
    holds: (playbook, sha256) => Effect.sync(() => kept.has(keyOf(playbook, sha256))),
    read: (playbook, sha256) => Effect.sync(() => readFrom(kept.get(keyOf(playbook, sha256)))),
    readPart: (playbook, sha256, asked) => Effect.sync(() => partFrom(kept.get(keyOf(playbook, sha256)), asked)),
    delete: (playbook, sha256) =>
      Effect.sync(() => {
        kept.delete(keyOf(playbook, sha256));
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

function standingHead({ playbook, sha256, head, keptAt, expiresAt, erasedAt }: MemoryHead): MemoryHead {
  return { playbook, sha256, head, keptAt, ...expiryOf(expiresAt), ...erasureOf(erasedAt) };
}

function newHead(content: ExpiredContent, { bytes, mediaType, expiresAt }: HeadToKeep, keptAt: number): MemoryHead {
  return { ...content, head: { bytes, mediaType }, keptAt, ...expiryOf(expiresAt) };
}

function keptOver(heads: Map<string, MemoryHead>, content: ExpiredContent, head: HeadToKeep, keptAt: number): HeadKept {
  const key = keyOf(content.playbook, content.sha256);
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
  const { playbook, sha256, head } = standing;
  heads.set(keyOf(playbook, sha256), {
    playbook,
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
  const key = keyOf(content.playbook, content.sha256);
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

function dueOf({ playbook, sha256, expiresAt, removingSince }: MemoryHead, times: ErasureTimes): readonly Due[] {
  const unmarked = removingSince === undefined || removingSince < times.staleBefore;
  return expiresAt !== undefined && expiresAt <= times.now && unmarked ? [[expiresAt, { playbook, sha256 }]] : [];
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
  heads.set(keyOf(standing.playbook, standing.sha256), { ...standing, removingSince: since });
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
  const { playbook, sha256, head, keptAt } = standing;
  heads.set(key, { playbook, sha256, head, keptAt, erasedAt: since });
  return true;
}

function nothingHeld(): boolean {
  return false;
}

export function memoryContentHeads(heldIn: HeldIn = nothingHeld): ContentHeads {
  const heads = new Map<string, MemoryHead>();
  return {
    kept: (playbook, sha256, head, keptAt) => Effect.sync(() => keptOver(heads, { playbook, sha256 }, head, keptAt)),
    touched: (playbook, sha256, keptAt, expiresAt) =>
      Effect.sync(() => {
        const standing = heads.get(keyOf(playbook, sha256));
        return standing === undefined || standing.erasedAt !== undefined
          ? undefined
          : touchedOver(heads, standing, keptAt, expiresAt);
      }),
    marked: (playbook, sha256, times) =>
      Effect.sync(() =>
        heldIn(playbook, sha256) ? { marked: false, answer: 'held' } : markedIn(heads, { playbook, sha256 }, times),
      ),
    cleared: (playbook, sha256, since) =>
      Effect.sync(() => {
        const key = keyOf(playbook, sha256);
        if (heads.get(key)?.removingSince === since) {
          heads.delete(key);
        }
      }),
    unmarked: (playbook, sha256, since) =>
      Effect.sync(() => {
        unmarkedIn(heads, keyOf(playbook, sha256), since);
      }),
    read: (playbook, sha256) =>
      Effect.sync(() => {
        const standing = heads.get(keyOf(playbook, sha256));
        return standing === undefined || standing.markedAlone === true ? undefined : headRead(standing);
      }),
    expired: (times, most) => Effect.sync(() => expiredIn(heads, times, most)),
    erasing: (playbook, sha256, times) => Effect.sync(() => erasingIn(heads, keyOf(playbook, sha256), times)),
    erased: (playbook, sha256, since) => Effect.sync(() => erasedIn(heads, keyOf(playbook, sha256), since)),
  };
}

export function memoryRecordedContent(): RecordedContent {
  return keptOutside(memoryContentHeads(), memoryContentStore()).content;
}
