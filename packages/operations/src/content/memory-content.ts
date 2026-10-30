import { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { streamPrefixOfPlaybook } from '../ledger/bound-ports.ts';
import { mostContentChunkBytes } from './content-chunks.ts';
import { leftUnread, requireExpected, takenInChunks } from './content-intake.ts';
import type { ContentRefused } from './content-refusals.ts';
import type { ContentKept, RecordedContent } from './recorded-content.ts';
import { stagingEnded, type StagingEnded } from './staging-ended.ts';
import type { ContentToKeep, StreamedContent } from './streamed-content.ts';

interface KeptBytes {
  readonly chunks: Blob;
  readonly mediaType: string;
}

type Shelf = Map<string, KeptBytes>;

interface Received {
  readonly sha256: string;
  readonly kept: KeptBytes;
}

function received({ stream, mediaType, expected }: ContentToKeep): Effect.Effect<Received, ContentRefused> {
  return Effect.gen(function* () {
    const chunks: Readonly<Uint8Array<ArrayBuffer>>[] = [];
    const taken = yield* takenInChunks(stream, mostContentChunkBytes, (chunk) =>
      Effect.sync(() => {
        chunks.push(chunk);
      }),
    );
    yield* requireExpected(expected, taken);
    return { sha256: taken.sha256, kept: { chunks: new Blob(chunks), mediaType } };
  });
}

function keptOn(shelf: Shelf, { sha256, kept }: Received): ContentKept {
  const held = shelf.get(sha256) ?? kept;
  shelf.set(sha256, held);
  return { sha256, bytes: held.chunks.size, mediaType: held.mediaType };
}

function readFrom(shelf: Shelf | undefined, sha256: string): StreamedContent | undefined {
  const kept = shelf?.get(sha256);
  return kept === undefined
    ? undefined
    : { stream: kept.chunks.stream(), bytes: kept.chunks.size, mediaType: kept.mediaType };
}

function runKeyOf(playbook: PlaybookAddress, run: string): string {
  return `${streamPrefixOfPlaybook(playbook)}${run}`;
}

export function memoryRecordedContent(): RecordedContent {
  const kept = new Map<string, Shelf>();
  const staging = new Map<string, Shelf>();
  const unstaged = new Set<string>();
  const shelfOf = (shelves: Map<string, Shelf>, key: string): Shelf => {
    const shelf = shelves.get(key) ?? new Map<string, KeptBytes>();
    shelves.set(key, shelf);
    return shelf;
  };
  const ended = (run: string, key: string): Effect.Effect<void, StagingEnded> =>
    Effect.suspend(() => (unstaged.has(key) ? Effect.fail(stagingEnded(run)) : Effect.void));
  return {
    put: (playbook, content) =>
      Effect.map(received(content), (taken) => keptOn(shelfOf(kept, streamPrefixOfPlaybook(playbook)), taken)),
    get: (playbook, sha256) => Effect.sync(() => readFrom(kept.get(streamPrefixOfPlaybook(playbook)), sha256)),
    stage: (playbook, run, content) => {
      const key = runKeyOf(playbook, run);
      return ended(run, key).pipe(
        Effect.tapError(() => leftUnread(content.stream)),
        Effect.andThen(received(content)),
        Effect.tap(() => ended(run, key)),
        Effect.map((taken) => keptOn(shelfOf(staging, key), taken)),
      );
    },
    staged: (playbook, run, sha256) => Effect.sync(() => readFrom(staging.get(runKeyOf(playbook, run)), sha256)),
    unstage: (playbook, run) =>
      Effect.sync(() => {
        const key = runKeyOf(playbook, run);
        unstaged.add(key);
        staging.delete(key);
      }),
  };
}
