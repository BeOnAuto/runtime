import { readFileSync } from 'node:fs';

import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  HeldContentNotGiven,
  RunInputSchema,
  RunLogEventSchema,
  RunStateSchema,
  StateFormatSchema,
  keptValuesReached,
  loadedRunOf,
  snapshotFromChunks,
  stateFormatKeepingPayloads,
  stateInCurrentFormat,
  type HeldContent,
} from '../index.ts';
import { addsAKeptValue, formatEleven, keptAlong, keptValuesIn } from '../kept-testing/kept-events.ts';
import { testWorkflowMachine as machine } from '../pool-testing/test-sandbox.ts';
import { statesAlong } from '../testing/run-history.ts';

const StoredEventsSchema = Schema.Array(Schema.Struct({ version: Schema.Int, event: RunLogEventSchema }));

const CorpusSchema = Schema.toCodecJson(
  Schema.Struct({
    format: StateFormatSchema,
    stream: StoredEventsSchema,
    snapshot: Schema.Struct({ chunks: Schema.Array(Schema.String), bytes: Schema.Int, tail: StoredEventsSchema }),
    state: Schema.Json,
  }),
);

const PayloadsSchema = Schema.toCodecJson(
  Schema.Struct({
    next: Schema.Struct({ input: RunInputSchema, payloadOffloading: Schema.Boolean }),
    texts: Schema.Record(Schema.String, Schema.String),
  }),
);

type Corpus = typeof CorpusSchema.Type;

const readCorpus = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusSchema));

const readPayloads = Schema.decodeUnknownSync(Schema.fromJsonString(PayloadsSchema));

const encodeState = Schema.encodeSync(Schema.toCodecJson(RunStateSchema));

function fileIn(path: string): string {
  return readFileSync(new URL(`../../corpus/${path}`, import.meta.url), 'utf8');
}

const crossing = readCorpus(fileIn('crossings/format-11-to-12.json'));

const switchedOff = readCorpus(fileIn('crossings/format-12-switched-off.json'));

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

describe('a run that crosses from format 11 to format 12', () => {
  it('loads from its whole stream and from its snapshot and tail to the state it recorded', () => {
    const recorded = stateInCurrentFormat(crossing.format, crossing.state);

    expect(loadedBothWays(crossing)).toEqual([recorded, recorded, 6, 6, 12, 12]);
  });

  it('holds three events of format 11 and the rest of format 12, a snapshot of format 12, and kept arms only at 12', () => {
    expect(crossing.stream.map(({ event }) => event.format)).toEqual([11, 11, 11, 12, 12, 12]);
    expect(snapshotIn(crossing).format).toBe(stateFormatKeepingPayloads);
    expect(crossing.stream.map(({ event }) => addsAKeptValue(event))).toEqual([false, false, false, true, true, false]);
  });

  it('reaches the crossing with a state the reader of format 11 passes on, every value inline, and leaves it with one that reader refuses', () => {
    const [atTheCrossing, after] = statesAlong(crossing.stream)
      .slice(2, 4)
      .map((state) => encodeState(state));

    expect(formatEleven?.read(atTheCrossing)).toEqual(atTheCrossing);
    expect(() => formatEleven?.read(after)).toThrow(/value/u);
  });
});

describe('a run whose engine stopped keeping values outside', () => {
  it('loads from its whole stream and from its snapshot and tail to the state it recorded', () => {
    const recorded = stateInCurrentFormat(switchedOff.format, switchedOff.state);

    expect(loadedBothWays(switchedOff)).toEqual([recorded, recorded, 5, 5, 12, 12]);
  });

  it('stays at format 12 after it stopped, its last three events naming no payload and holding their new values inline', () => {
    const events = switchedOff.stream.map(({ event }) => event);

    expect(events.map(({ format }) => format)).toEqual([12, 12, 12, 12, 12]);
    expect(keptAlong(switchedOff.stream).map((kept) => kept?.length)).toEqual([1, 1, 0, 0, 0]);
    expect(events.slice(2).some((event) => addsAKeptValue(event))).toBe(false);
    expect(JSON.stringify(events[2])).toContain('z'.repeat(20_000));
    expect(
      statesAlong(switchedOff.stream)
        .slice(2)
        .map((state) => keptValuesIn(state).length),
    ).toEqual([2, 1, 1]);
  });
});

const writeCorpus = Schema.encodeSync(CorpusSchema);

describe.each(['format-11-to-12', 'format-12-switched-off'])('the crossing %s', (name) => {
  it('is written back text for text as it was recorded, its events of format 11 as the release before writes them', () => {
    const text = fileIn(`crossings/${name}.json`);

    expect(JSON.stringify(writeCorpus(readCorpus(text)))).toBe(JSON.stringify(JSON.parse(text)));
  });
});

function corpusNamed(name: string): Corpus {
  return readCorpus(fileIn(name === 'format-12' ? `${name}.json` : `crossings/${name}.json`));
}

describe.each(['format-12', 'format-11-to-12', 'format-12-switched-off'])('the next input of %s', (name) => {
  const corpus = corpusNamed(name);
  const { next, texts } = readPayloads(fileIn(`payloads/${name}.json`));
  const snapshot = { snapshot: snapshotIn(corpus), bytes: corpus.snapshot.bytes };
  const atSnapshot = loadedRunOf({ snapshot, tail: [] });
  const contents = new Map(
    Object.entries(texts).map(([sha256, text]: readonly [string, string]) => [sha256, { kind: 'read', text } as const]),
  );

  it('is decided, with the texts of the payloads its state reaches, as the event the corpus recorded after its snapshot', () => {
    const decided = machine.decision(next.input, atSnapshot.state, {
      contents,
      format: atSnapshot.format,
      payloadOffloading: next.payloadOffloading,
    });

    expect(keptValuesReached(atSnapshot.state).every(({ sha256 }) => contents.has(sha256))).toBe(true);
    expect(decided.events).toEqual([corpus.snapshot.tail[0]?.event]);
    expect(decided.payloads.every(({ sha256, text }) => texts[sha256] === text)).toBe(true);
  });

  it('is not decided without those texts: a decision given none of them dies rather than guess', () => {
    const nothing = new Map<string, HeldContent>();
    const given = { contents: nothing, format: atSnapshot.format, payloadOffloading: next.payloadOffloading };

    expect(keptValuesReached(atSnapshot.state).length).toBeGreaterThan(0);
    expect(() => machine.decision(next.input, atSnapshot.state, given)).toThrow(HeldContentNotGiven);
  });
});
