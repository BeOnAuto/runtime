import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  loadedRunOf,
  RunLogEventSchema,
  SnapshotSchema,
  snapshotFromChunks,
  stateFormats,
  stateInCurrentFormat,
  StateFormatSchema,
} from '../index.ts';

const StoredEventsSchema = Schema.Array(Schema.Struct({ version: Schema.Int, event: RunLogEventSchema }));

const CorpusSchema = Schema.Struct({
  format: StateFormatSchema,
  stream: StoredEventsSchema,
  snapshot: Schema.Struct({ chunks: Schema.Array(Schema.String), bytes: Schema.Int, tail: StoredEventsSchema }),
  state: Schema.Json,
});

type Corpus = typeof CorpusSchema.Type;

const CorpusJsonSchema = Schema.toCodecJson(CorpusSchema);

const decodeCorpus = Schema.decodeUnknownSync(CorpusJsonSchema);

const writeCorpus = Schema.encodeSync(CorpusJsonSchema);

const writeSnapshot = Schema.encodeSync(Schema.toCodecJson(SnapshotSchema));

const readJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const directory = fileURLToPath(new URL('../../corpus/', import.meta.url));

const committed: readonly unknown[] = readdirSync(directory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => readJson(readFileSync(`${directory}${name}`, 'utf8')));

const corpora: readonly Corpus[] = committed.map((file) => decodeCorpus(file));

const withFiles = corpora.map((corpus, index): readonly [Corpus, unknown] => [corpus, committed[index]]);

const sinceFormatEight = withFiles.filter(([{ format }]) => format >= 8);

const beforeFormatEight = withFiles.filter(([{ format }]) => format < 8);

function snapshotIn({ snapshot }: Corpus) {
  return Result.getOrThrow(snapshotFromChunks(snapshot.chunks));
}

function loadedBothWays(corpus: Corpus): readonly unknown[] {
  const whole = loadedRunOf({ snapshot: null, tail: corpus.stream });
  const fromSnapshot = loadedRunOf({
    snapshot: { snapshot: snapshotIn(corpus), bytes: corpus.snapshot.bytes },
    tail: corpus.snapshot.tail,
  });
  return [whole.state, fromSnapshot.state, whole.version, fromSnapshot.version];
}

function formatsNamed(corpus: Corpus): readonly number[] {
  return [
    ...new Set([
      ...corpus.stream.map(({ event }) => event.format),
      ...corpus.snapshot.tail.map(({ event }) => event.format),
      snapshotIn(corpus).format,
    ]),
  ];
}

describe('the committed corpus of past state formats', () => {
  it('holds a stream and a snapshot for every state format up to the current one', () => {
    expect(corpora.map(({ format }) => format).toSorted((first, second) => first - second)).toEqual(
      Array.from({ length: stateFormats.current }, (_, index) => index + 1),
    );
    expect(corpora.map((corpus) => formatsNamed(corpus))).toEqual(corpora.map(({ format }) => [format]));
  });

  it('reads each event and snapshot of formats 8 on with the schemas of the format it names, and writes it back text for text as it was committed, so a member written in another order is refused', () => {
    expect(sinceFormatEight.map(([corpus]) => JSON.stringify(writeCorpus(corpus)))).toEqual(
      sinceFormatEight.map(([, file]) => JSON.stringify(file)),
    );
    expect(sinceFormatEight.map(([corpus]) => JSON.stringify(writeSnapshot(snapshotIn(corpus))))).toEqual(
      sinceFormatEight.map(([{ snapshot }]) => snapshot.chunks.join('')),
    );
  });

  it('reads each event and snapshot of formats 1 to 7, whose records it renames as it reads them and never writes, and writes back the same values', () => {
    expect(beforeFormatEight.map(([corpus]) => writeCorpus(corpus))).toEqual(beforeFormatEight.map(([, file]) => file));
    expect(beforeFormatEight.map(([corpus]) => writeSnapshot(snapshotIn(corpus)))).toEqual(
      beforeFormatEight.map(([{ snapshot }]) => readJson(snapshot.chunks.join(''))),
    );
  });

  it('reads the state each snapshot holds, before the run ended, in the current format, so a member no format describes is refused there', () => {
    expect(
      corpora.map((corpus) => {
        const { format, state } = snapshotIn(corpus);
        return stateInCurrentFormat(format, state).runId;
      }),
    ).toEqual(corpora.map(({ format, state }) => stateInCurrentFormat(format, state).runId));
  });

  it('still loads, from the whole stream and from the snapshot and its tail, to the state it recorded', () => {
    expect(corpora.map((corpus) => loadedBothWays(corpus))).toEqual(
      corpora.map(({ format, state, stream }) => {
        const recorded = stateInCurrentFormat(format, state);
        return [recorded, recorded, stream.length, stream.length];
      }),
    );
  });
});
