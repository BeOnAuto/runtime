import { Effect } from 'effect';

import { streamPrefixOfPlaybook } from '../ledger/bound-ports.ts';
import { mostContentChunkBytes } from './content-chunks.ts';
import { requireExpected, takenInChunks } from './content-intake.ts';
import type { ContentRefused } from './content-refusals.ts';
import type { ContentKept, RecordedContent } from './recorded-content.ts';
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

export function memoryRecordedContent(): RecordedContent {
  const kept = new Map<string, Shelf>();
  const shelfOf = (key: string): Shelf => {
    const shelf = kept.get(key) ?? new Map<string, KeptBytes>();
    kept.set(key, shelf);
    return shelf;
  };
  return {
    put: (playbook, content) =>
      Effect.map(received(content), (taken) => keptOn(shelfOf(streamPrefixOfPlaybook(playbook)), taken)),
    get: (playbook, sha256) => Effect.sync(() => readFrom(kept.get(streamPrefixOfPlaybook(playbook)), sha256)),
  };
}
