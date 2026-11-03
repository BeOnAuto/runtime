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
  HeadKept,
  HeadMarked,
  RecordedContent,
  RemovalTimes,
  StagedContent,
} from '../content/recorded-content.ts';
import type { StreamedContent } from '../content/streamed-content.ts';

interface KeptBytes {
  readonly chunks: Blob;
  readonly mediaType: string;
}

interface MemoryHead {
  readonly head: ContentHead;
  readonly keptAt: number;
  readonly removingSince?: number;
  readonly markedAlone?: boolean;
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

function keptOver(heads: Map<string, MemoryHead>, key: string, head: ContentHead, keptAt: number): HeadKept {
  const standing = heads.get(key);
  if (standing === undefined) {
    heads.set(key, { head, keptAt });
    return { kept: 'new', head };
  }
  return touchedOver(heads, key, standing, keptAt);
}

function touchedOver(heads: Map<string, MemoryHead>, key: string, standing: MemoryHead, keptAt: number): HeadKept {
  if (standing.removingSince !== undefined) {
    return { kept: 'removing', since: standing.removingSince };
  }
  heads.set(key, { ...standing, keptAt });
  return { kept: 'standing', head: standing.head };
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

function markedIn(heads: Map<string, MemoryHead>, key: string, times: RemovalTimes): HeadMarked {
  const standing = heads.get(key);
  const marked = markedOver(standing, times);
  if (marked.marked) {
    heads.set(key, { ...(standing ?? { head: noHead, keptAt: 0, markedAlone: true }), removingSince: marked.since });
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
  heads.set(key, { head: standing.head, keptAt: standing.keptAt });
}

function nothingHeld(): boolean {
  return false;
}

export function memoryContentHeads(heldIn: HeldIn = nothingHeld): ContentHeads {
  const heads = new Map<string, MemoryHead>();
  return {
    kept: (playbook, sha256, head, keptAt) => Effect.sync(() => keptOver(heads, keyOf(playbook, sha256), head, keptAt)),
    touched: (playbook, sha256, keptAt) =>
      Effect.sync(() => {
        const key = keyOf(playbook, sha256);
        const standing = heads.get(key);
        return standing === undefined ? undefined : touchedOver(heads, key, standing, keptAt);
      }),
    marked: (playbook, sha256, times) =>
      Effect.sync(() =>
        heldIn(playbook, sha256) ? { marked: false, answer: 'held' } : markedIn(heads, keyOf(playbook, sha256), times),
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
        return standing?.markedAlone === true ? undefined : standing?.head;
      }),
  };
}

export function memoryRecordedContent(): RecordedContent {
  return keptOutside(memoryContentHeads(), memoryContentStore()).content;
}
