import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import {
  loadedRunOf,
  RunLogEventSchema,
  SnapshotSchema,
  snapshotFromChunks,
  stateFormats,
  stateInCurrentFormat,
  StateFormatSchema,
} from '../index.ts';
import type { RunState } from '../machine/run-state.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { workflow } from '../testing/workflows.ts';

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

const KeptValuesCorpusSchema = Schema.toCodecJson(
  Schema.Struct({ format: StateFormatSchema, stream: StoredEventsSchema, state: Schema.Json }),
);

const readKeptValuesCorpus = Schema.decodeUnknownSync(Schema.fromJsonString(KeptValuesCorpusSchema));

function keptValuesText(name: string): string {
  return readFileSync(new URL(`../../corpus/kept-values/${name}.json`, import.meta.url), 'utf8');
}

function writtenBack(corpus: typeof KeptValuesCorpusSchema.Type): string {
  return `${JSON.stringify(Schema.encodeSync(KeptValuesCorpusSchema)(corpus), null, 2)}\n`;
}

const page = {
  id: '019a5b12-0000-7000-8000-000000000081',
  media_type: 'text/markdown',
  bytes: 3355443,
  sha256: 'c'.repeat(64),
  address: null,
  address_until: null,
};

function documentOf({ workflow: started }: RunState): JsonObject {
  if (started === null) {
    throw new RangeError('The corpus records no workflow');
  }
  return started.document;
}

function decidedNow(set: string) {
  const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';
  const driver = memoryDriver({ sandbox: testSandbox, startedAt: Date.UTC(2026, 10, 16, 9) });
  driver.start({ runId, input: { page }, document: workflow(`do:\n  - read: { set: ${set} }`) });
  return driver.runUntilEnded(runId).outcome;
}

describe('a run recorded before a workflow refused to read inside an asset', () => {
  const text = keptValuesText('read-inside-recorded-before');
  const corpus = readKeptValuesCorpus(text);

  it('is written back text for text as it was recorded', () => {
    expect(writtenBack(corpus)).toBe(text);
  });

  it('loads from its stream to the state it recorded, with what it read inside the asset as it read it then', () => {
    const recorded = stateInCurrentFormat(corpus.format, corpus.state);
    const loaded = loadedRunOf({ snapshot: null, tail: corpus.stream });

    expect([loaded.state, loaded.format]).toEqual([recorded, 11]);
    expect(loaded.state.outcome).toEqual({ kind: 'completed', output: { title: null, kind: 'text/markdown', page } });
  });
});

describe('a workflow that holds an asset, decided now', () => {
  it('reads the asset’s own members and passes it on whole', () => {
    expect(decidedNow("{ kind: '${ $data.page.media_type }', page: '${ $data.page }' }")).toEqual({
      kind: 'completed',
      output: { kind: 'text/markdown', page },
    });
  });

  it('is raised as a failed expression where an expression reads inside the asset', () => {
    expect(decidedNow("{ title: '${ $data.page.title ?? null }' }")).toMatchObject({
      kind: 'raised',
      error: { status: 400 },
    });
  });
});

describe('a run recorded before a workflow refused to read inside an asset, whose expressions name large values, several in one task', () => {
  const workText = keptValuesText('expression-work-recorded-before');
  const work = readKeptValuesCorpus(workText);
  const workRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';
  const recorded = stateInCurrentFormat(work.format, work.state);

  it('is written back text for text as it was recorded', () => {
    expect(writtenBack(work)).toBe(workText);
  });

  it('loads from its stream to the state it recorded, after the yield the work of its expressions asked for', () => {
    const loaded = loadedRunOf({ snapshot: null, tail: work.stream });

    expect([loaded.state, loaded.format, work.stream.length]).toEqual([recorded, 11, 2]);
    expect(loaded.state.outcome).toEqual({ kind: 'completed', output: { n13: 8013, dear: 3999, total: 2_999_997 } });
  });

  it('is decided now event for event as it was decided then, its expressions charged what they were charged then', () => {
    const driver = memoryDriver({ sandbox: testSandbox, startedAt: Date.UTC(2026, 10, 16, 9) });

    driver.start({ runId: workRunId, input: {}, document: documentOf(recorded) });
    driver.runUntilEnded(workRunId);

    expect(Effect.runSync(driver.ports.runStore.eventsAfter(workRunId, 0))).toEqual(work.stream);
  });
});
