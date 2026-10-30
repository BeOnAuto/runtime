import {
  sha256Of,
  textOfContent,
  textToKeep,
  type PlaybookAddress,
  type ContentToKeep,
  type RecordedContent,
} from '@on.auto/operations';
import { answerOfAbout, generatedStream, octets, readThrough } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { inTurn, timed, write } from './stores.ts';

const sizes: readonly (readonly [string, number])[] = [
  ['100 B', 100],
  ['64 KiB', 65_536],
  ['1 MB', 1_000_000],
  ['5 MB', 5_000_000],
  ['20 MB', 20_000_000],
];

const playbook = { org: 'acme', playbook: 'alpha' };

const mebibyte = 1_048_576;

const streamedBytes = 64 * mebibyte;

const sampleSeed = 7;

interface Held {
  readonly heap: number;
  readonly resident: number;
}

function milliseconds(value: number): string {
  return `${value.toFixed(value < 1 ? 2 : 1)} ms`;
}

function heldNow(): Held {
  globalThis.gc?.();
  const { heapUsed, arrayBuffers, rss } = process.memoryUsage();
  return { heap: heapUsed + arrayBuffers, resident: rss };
}

async function mostHeldDuring(work: () => Promise<unknown>): Promise<Held> {
  const before = heldNow();
  let most = before;
  const sampling = setInterval(() => {
    const now = heldNow();
    most = { heap: Math.max(most.heap, now.heap), resident: Math.max(most.resident, now.resident) };
  }, 5);
  try {
    await work();
  } finally {
    clearInterval(sampling);
  }
  return { heap: most.heap - before.heap, resident: most.resident - before.resident };
}

async function piecesOf(stream: ReadableStream<Uint8Array>): Promise<readonly Readonly<Uint8Array>[]> {
  const pieces: Readonly<Uint8Array>[] = [];
  for await (const piece of stream) {
    pieces.push(piece);
  }
  return pieces;
}

function streamOf(pieces: readonly Readonly<Uint8Array>[]): ContentToKeep {
  let next = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const piece = pieces[next];
      next += 1;
      if (piece === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(piece);
    },
  });
  return { stream, mediaType: octets };
}

function put(content: RecordedContent, into: PlaybookAddress, kept: ContentToKeep): Promise<unknown> {
  return Effect.runPromise(content.put(into, kept));
}

async function measuredText(content: RecordedContent, name: string): Promise<void> {
  await inTurn(sizes, async ([label, bytes]) => {
    const text = answerOfAbout(bytes);
    const sha256 = sha256Of(text);
    const [first, second, expected] = [
      textToKeep(text, 'application/json'),
      textToKeep(text, 'application/json'),
      { ...textToKeep(text, 'application/json'), expected: { sha256 } },
    ];
    const kept = await timed(() => put(content, playbook, first));
    const again = await timed(() => put(content, playbook, second));
    const givenItsDigest = await timed(() => put(content, playbook, expected));
    let read = '';
    const got = await timed(async () => {
      const streamed = await Effect.runPromise(content.get(playbook, sha256));
      read = streamed === undefined ? '' : await Effect.runPromise(textOfContent(streamed));
      JSON.parse(read);
    });
    write(
      `| ${name} | ${label} | ${milliseconds(kept)} | ${milliseconds(again)} | ${milliseconds(givenItsDigest)} | ${milliseconds(got)} | ${String(read === text)} |`,
    );
  });
}

async function readBack(content: RecordedContent, from: PlaybookAddress, sha256: string) {
  const streamed = await Effect.runPromise(content.get(from, sha256));
  return streamed === undefined ? undefined : readThrough(streamed.stream);
}

function mebibytes(bytes: number): string {
  return `${(bytes / mebibyte).toFixed(1)} MiB`;
}

async function heldWhileStreamed(content: RecordedContent, name: string, sha256: string): Promise<string> {
  const elsewhere = { org: 'acme', playbook: 'beta' };
  const putting = await mostHeldDuring(() =>
    put(content, elsewhere, { stream: generatedStream(streamedBytes, sampleSeed), mediaType: octets }),
  );
  const getting = await mostHeldDuring(() => readBack(content, elsewhere, sha256));
  return `${name}: while putting 64 MiB, at most ${mebibytes(putting.heap)} more heap and array buffers after a full collection and ${mebibytes(putting.resident)} more resident set; while getting it, ${mebibytes(getting.heap)} and ${mebibytes(getting.resident)}`;
}

async function measuredStream(content: RecordedContent, name: string): Promise<string> {
  const pieces = await piecesOf(generatedStream(streamedBytes, sampleSeed));
  const { sha256 } = await readThrough(streamOf(pieces).stream);
  const kept = await timed(() => put(content, playbook, streamOf(pieces)));
  const again = await timed(() => put(content, playbook, streamOf(pieces)));
  const givenItsDigest = await timed(() => put(content, playbook, { ...streamOf(pieces), expected: { sha256 } }));
  let read = await readBack(content, playbook, sha256);
  const got = await timed(async () => {
    read = await readBack(content, playbook, sha256);
  });
  write(
    `| ${name} | 64 MiB, streamed | ${milliseconds(kept)} | ${milliseconds(again)} | ${milliseconds(givenItsDigest)} | ${milliseconds(got)} | ${String(read?.sha256 === sha256 && read.bytes === streamedBytes)} |`,
  );
  return heldWhileStreamed(content, name, sha256);
}

export function contentTableHead(): void {
  write(
    '| Store | Content | Kept | Kept again | Kept again, its digest given | Read back and parsed | Joined back exactly |',
  );
  write('| --- | --- | --- | --- | --- | --- | --- |');
}

export async function measuredContent(name: string, content: RecordedContent): Promise<string> {
  await measuredText(content, name);
  return measuredStream(content, name);
}
