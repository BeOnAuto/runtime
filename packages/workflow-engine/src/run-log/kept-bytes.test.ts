import { readFileSync } from 'node:fs';

import type { Digested } from '@on.auto/content';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  RunInputSchema,
  RunLogEventSchema,
  StateFormatSchema,
  eventBytesOf,
  loadedRunOf,
  mostEventBytes,
  mostInlineHeldValueBytes,
  snapshotFromChunks,
  stateInCurrentFormat,
  type PositionedEvent,
  type RunLogEvent,
} from '../index.ts';
import { testWorkflowMachine as machine } from '../pool-testing/test-sandbox.ts';

const StoredEventsSchema = Schema.Array(Schema.Struct({ version: Schema.Int, event: RunLogEventSchema }));

const CorpusSchema = Schema.toCodecJson(
  Schema.Struct({
    format: StateFormatSchema,
    stream: StoredEventsSchema,
    snapshot: Schema.Struct({ chunks: Schema.Array(Schema.String), bytes: Schema.Int, tail: StoredEventsSchema }),
    state: Schema.Json,
  }),
);

const NextInputSchema = Schema.toCodecJson(
  Schema.Struct({
    next: Schema.Struct({ input: RunInputSchema, payloadOffloading: Schema.Boolean }),
    texts: Schema.Record(Schema.String, Schema.String),
  }),
);

type Corpus = typeof CorpusSchema.Type;

const readCorpus = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusSchema));

const readNextInput = Schema.decodeUnknownSync(Schema.fromJsonString(NextInputSchema));

const writeCorpus = Schema.encodeSync(CorpusSchema);

function fileIn(path: string): string {
  return readFileSync(new URL(`../../corpus/${path}`, import.meta.url), 'utf8');
}

function snapshotIn(corpus: Corpus) {
  return Result.getOrThrow(snapshotFromChunks(corpus.snapshot.chunks));
}

function loadedBothWays(corpus: Corpus): readonly unknown[] {
  const whole = loadedRunOf({ snapshot: null, tail: corpus.stream });
  const fromSnapshot = loadedRunOf({
    snapshot: { snapshot: snapshotIn(corpus), bytes: corpus.snapshot.bytes },
    tail: corpus.snapshot.tail,
  });
  return [whole.state, fromSnapshot.state, whole.version, fromSnapshot.version, whole.format, fromSnapshot.format];
}

function startingChangeOf(corpus: Corpus): RunLogEvent {
  const [started] = corpus.snapshot.tail;
  if (started === undefined) {
    throw new RangeError('The corpus holds no change after its snapshot');
  }
  return started.event;
}

function jsonBytesOf(event: RunLogEvent): number {
  return new TextEncoder().encode(JSON.stringify(event)).byteLength;
}

function keptIn(event: RunLogEvent): readonly Digested[] {
  return 'kept' in event ? event.kept : [];
}

function bytesNamedBy(event: RunLogEvent): number {
  const started = event.outputs.flatMap((output) =>
    output.kind === 'start_call' && 'arguments_bytes' in output ? [output.arguments_bytes] : [],
  );
  return [...keptIn(event).map(({ bytes }) => bytes), ...started].reduce((sum, bytes) => sum + bytes, 0);
}

interface Recorded {
  readonly name: string;
  readonly recordedBy: string;
  readonly keptBytes: number;
  readonly countedPastOneEvent: boolean;
}

const recordings: readonly Recorded[] = [
  {
    name: 'three-calls-within-one-event',
    recordedBy: 'the release before this one',
    keptBytes: 200_011 + 2 * 3 * 200_020,
    countedPastOneEvent: false,
  },
  {
    name: 'three-calls-past-one-event',
    recordedBy: 'this release',
    keptBytes: 250_011 + 2 * 3 * 250_020,
    countedPastOneEvent: true,
  },
];

describe.each(recordings)(
  'a run that starts three calls at once with inputs payload offloading keeps, $name, recorded by $recordedBy',
  ({ name, keptBytes, countedPastOneEvent }: Recorded) => {
    const text = fileIn(`kept-bytes/${name}.json`);
    const corpus = readCorpus(text);
    const started = startingChangeOf(corpus);

    it('is written back text for text as it was recorded', () => {
      expect(JSON.stringify(writeCorpus(corpus))).toBe(JSON.stringify(JSON.parse(text)));
    });

    it('loads from its whole stream and from its snapshot and tail to the state it recorded, its history counted to the byte', () => {
      const recorded = stateInCurrentFormat(corpus.format, corpus.state);

      expect(loadedBothWays(corpus)).toEqual([recorded, recorded, 5, 5, 12, 12]);
      expect(recorded.historyBytes).toBe(
        corpus.stream.reduce((sum, { event }: PositionedEvent) => sum + eventBytesOf(event), 0),
      );
    });

    it('records the change that starts the calls as JSON well within one event, naming each kept input by its digest and size, and counts in its history the bytes those inputs take', () => {
      expect(jsonBytesOf(started)).toBeLessThan(8192);
      expect(bytesNamedBy(started)).toBe(keptBytes);
      expect(eventBytesOf(started)).toBe(jsonBytesOf(started) + keptBytes);
      expect(eventBytesOf(started) > mostEventBytes).toBe(countedPastOneEvent);
    });

    it('is decided again from its snapshot: the input after it makes the change the corpus recorded, keeping the texts that change names', () => {
      const { next } = readNextInput(fileIn(`payloads/${name}.json`));
      const atSnapshot = loadedRunOf({
        snapshot: { snapshot: snapshotIn(corpus), bytes: corpus.snapshot.bytes },
        tail: [],
      });
      const decided = machine.decision(next.input, atSnapshot.state, {
        contents: new Map(),
        format: atSnapshot.format,
        payloadOffloading: next.payloadOffloading,
        payloadSizeThreshold: mostInlineHeldValueBytes,
      });

      expect(decided.events).toEqual([started]);
      expect(decided.payloads.map(({ sha256, bytes }) => ({ sha256, bytes }))).toEqual(keptIn(started));
    });
  },
);
