import { InvalidInput, NotFound } from '@on.auto/operations';
import { Effect, Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type Capability,
  type CapabilityDeclaration,
  defineCapability,
  defineCreateDefinition,
  defineRunDefinition,
  defineUpdateDefinition,
  type RunContext,
} from '../index.ts';
import { recordingJournal } from '../journal-testing/recording-journal.ts';
import { answeringLaterMs, answeringNowMs, asking, nudgesPresenter } from '../testing/asking.ts';
import { noCalledDefinitions } from '../testing/called-definitions.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { ExtensionManifestSchema } from './extension-manifest.ts';
import { firstLineOf } from './first-lines.ts';
import { knownCapabilities } from './known-capabilities.ts';
import { type KeptViewState, lagOf, viewStandingOf } from './view-standing.ts';

const parseWords = (source: string) =>
  source.trim() === ''
    ? Effect.fail(
        new InvalidInput({ detail: 'The document is empty', issues: [{ detail: 'Line 1 is empty', pointer: '' }] }),
      )
    : Effect.succeed({ words: source.trim().split(/\s+/u) });

const words: CapabilityDeclaration<{ readonly words: readonly string[] }> = {
  type: 'words',
  title: 'Words',
  guide: { name: 'words' },
  noun: { one: 'count', other: 'counts' },
  describeOutput: () => 'It counted the words.',
  mediaType: 'text/plain',
  parse: parseWords,
  summarize: (parsed) => ({ description: `${parsed.words.length} words` }),
  run: (parsed, input, run) => Effect.succeed({ output: { words: parsed.words, input }, record: { run: run.id } }),
};

const run: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: ['playbook:write'], playbooks: '*' },
  definition: { id: '0199a3c4-7d2e-7c1a-9b3f-0000000000d1', name: 'count', version: 3 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

const decoded = Schema.decodeUnknownOption(ExtensionManifestSchema);

const known = knownCapabilities([echo, probe().capability]);

const decodeType = Schema.decodeUnknownResult(known.field);

function refusalOf(input: unknown): string {
  return Result.match(decodeType(input), { onFailure: String, onSuccess: () => 'accepted' });
}

const live: KeptViewState = {
  version: 2,
  phase: 'live',
  view: {},
  checkpoint: 'cursor',
  checkpointAt: '2026-10-06T10:00:05.000Z',
  lastEvent: { id: 'event-1', time: '2026-10-06T10:00:04.000Z' },
  folded: 3,
};

describe('a capability', () => {
  it('keeps its type, title, description, noun, words for an output and media type', () => {
    const capability = defineCapability(words);

    expect(capability).toMatchObject({
      type: 'words',
      title: 'Words',
      guide: { name: 'words' },
      noun: { one: 'count', other: 'counts' },
      mediaType: 'text/plain',
    });
    expect(capability.describeOutput({ words: [] })).toBe('It counted the words.');
  });

  it('runs a run for at most the time it states, or 10 minutes when it states none', () => {
    expect([defineCapability(words), defineCapability({ ...words, longestAnyRunMs: 1_660_000 })]).toMatchObject([
      { longestAnyRunMs: 600_000 },
      { longestAnyRunMs: 1_660_000 },
    ]);
  });

  it.each(['ab', 'Words', '1words', 'word_s', `w${'o'.repeat(32)}`])('may not be named %j', (name) => {
    expect(() => defineCapability({ ...words, type: name })).toThrow(`The type ${name} is malformed`);
  });

  it('prepares a document by parsing it once, and summarizes and executes what it parsed', async () => {
    const prepared = await Effect.runPromise(defineCapability(words).prepare(' one two  three '));

    expect(prepared.summary).toEqual({ description: '3 words' });
    expect(await Effect.runPromise(prepared.run({ shout: true }, run))).toEqual({
      output: { words: ['one', 'two', 'three'], input: { shout: true } },
      record: { run: run.id },
    });
  });

  it('fails to prepare a document its parser rejects, with the issues the parser found', async () => {
    expect(await Effect.runPromise(Effect.flip(defineCapability(words).prepare('  ')))).toEqual(
      new InvalidInput({ detail: 'The document is empty', issues: [{ detail: 'Line 1 is empty', pointer: '' }] }),
    );
  });
});

describe('the reach of a capability', () => {
  it('reaches systems outside the server only when it says so, and so do run_definition and the saves, whose check may ask them, when one of its capabilities does', () => {
    const local = defineCapability(words);
    const outside = defineCapability({ ...words, type: 'lookup', reachesOutside: true });
    const operations = [
      (capabilities: readonly Capability[]) => defineRunDefinition(capabilities),
      (capabilities: readonly Capability[]) => defineCreateDefinition(capabilities, uncheckedPages),
      (capabilities: readonly Capability[]) => defineUpdateDefinition(capabilities, uncheckedPages),
    ];

    expect([local.reachesOutside, outside.reachesOutside]).toEqual([false, true]);
    expect(
      operations.map((define) => [
        define([local]).registration.reachesOutside,
        define([local, outside]).registration.reachesOutside,
      ]),
    ).toEqual([
      [false, true],
      [false, true],
      [false, true],
    ]);
  });
});

describe('the change a capability may make outside the server', () => {
  it('is none unless it says so, and run_definition may change the outside when one of its capabilities may', () => {
    const local = defineCapability(words);
    const acting = defineCapability({ ...words, type: 'acting', reachesOutside: true, mayChangeOutside: true });

    expect([local.mayChangeOutside, acting.mayChangeOutside]).toEqual([false, true]);
    expect([
      defineRunDefinition([local]).registration.mayChangeOutside,
      defineRunDefinition([local, acting]).registration.mayChangeOutside,
    ]).toEqual([false, true]);
  });
});

describe('what a capability declares of its runs', () => {
  it('is known to a run in a test by none of the definitions it might call', async () => {
    expect(await Effect.runPromise(run.longestRunOf('probe', 'plain'))).toBeUndefined();
  });

  it('is that they end within their call, within its longest run, unless it says otherwise', async () => {
    const plain = await Effect.runPromise(defineCapability(words).prepare('one two'));
    const later = await Effect.runPromise(
      defineCapability({
        ...words,
        finishesLater: true,
        longestRunOf: ({ words: given }) => given.length * 1000,
      }).prepare('one two'),
    );

    expect(
      [plain, later].map(({ finishesLaterFor, longestRunMs, longestRunMsFor }) => [
        finishesLaterFor({}),
        longestRunMs,
        longestRunMsFor({}),
      ]),
    ).toEqual([
      [false, 600_000, 600_000],
      [true, 2000, 2000],
    ]);
  });
});

describe('what a capability decides of each document and each input, and says of its runs', () => {
  it('finishes later for the documents it says do, when it decides by what it parsed', async () => {
    const deciding = defineCapability({ ...words, finishesLater: ({ words: given }) => given.includes('later') });

    expect([
      (await Effect.runPromise(deciding.prepare('now'))).finishesLaterFor({}),
      (await Effect.runPromise(deciding.prepare('answer later'))).finishesLaterFor({}),
    ]).toEqual([false, true]);
  });

  it('finishes later and runs as long as it says for each input, and as long as any input may for one it is not given', async () => {
    const prepared = await Effect.runPromise(asking.prepare('Approve the brief?'));

    expect([
      [prepared.finishesLaterFor({ now: true }), prepared.longestRunMsFor({ now: true })],
      [prepared.finishesLaterFor({ campaign: 'Spring' }), prepared.longestRunMsFor({ campaign: 'Spring' })],
      prepared.longestRunMs,
    ]).toEqual([[false, answeringNowMs], [true, answeringLaterMs], answeringLaterMs]);
  });

  it('gives no words of a deferral unless it gives its own', () => {
    const own = defineCapability({
      ...words,
      runWords: { deferral: (record) => ({ summary: 'Waiting.', data: record }) },
    });

    expect([defineCapability(words).runWords.deferral({}), own.runWords.deferral({ to: 'ada' })]).toEqual([
      undefined,
      { summary: 'Waiting.', data: { to: 'ada' } },
    ]);
  });

  it('declares no facts of its own unless it declares them, on its runs and in the stream kinds it owns', () => {
    expect([defineCapability(words).facts, asking.facts]).toMatchObject([
      { onRuns: [], streams: [] },
      { onRuns: [{ type: 'nudge_sent' }], streams: [nudgesPresenter] },
    ]);
    expect(asking.describeOutput({ answered: 'yes' })).toBe('It was answered.');
  });
});

describe('the cancelling of a run', () => {
  it('cancels a run by settling it as cancelled with the kind and reason asked, unless it decides otherwise', () => {
    const asked = {
      run: { org: 'acme', playbook: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
      record: { step: 1 },
      kind: 'deadline',
      reason: 'The step ran out of time',
      answer: null,
      work: [],
    } as const;
    const deciding = defineCapability({
      ...words,
      cancel: ({ record }) => ({ status: 'rejected', reason: 'conflict', detail: `At step ${JSON.stringify(record)}` }),
    });

    expect([defineCapability(words).cancel(asked), deciding.cancel(asked)]).toEqual([
      { status: 'rejected', reason: 'cancelled', kind: 'deadline', detail: 'The step ran out of time' },
      { status: 'rejected', reason: 'conflict', detail: 'At step {"step":1}' },
    ]);
  });
});

describe('the manifest of an extension', () => {
  it('names the package and its version, and the point each implementation fills with the contract it was built against', () => {
    const implementation = { answers: 'example' };
    const manifest = {
      name: '@example/extension',
      version: '2.0.0',
      provides: [{ point: 'example/point', contract: 3, implementation }],
    };

    expect(Option.getOrThrow(decoded(manifest)).provides).toEqual([
      { point: 'example/point', contract: 3, implementation },
    ]);
  });

  it('is refused without the points it provides, or with a contract that is not a whole number', () => {
    expect([
      decoded({ name: '@example/extension', version: '2.0.0' }),
      decoded({ name: '@example/extension', version: '2.0.0', provides: [{ point: 'p', contract: 1.5 }] }),
    ]).toEqual([Option.none(), Option.none()]);
  });
});

describe('the words of a failure an extension throws', () => {
  it('are the first line of its message, or of what else was thrown, trimmed', () => {
    expect([
      firstLineOf(new Error('  first  \nsecond')),
      firstLineOf('plain\nrest'),
      firstLineOf(new Error('')),
    ]).toEqual(['first', 'plain', '']);
  });
});

describe('the type field of the definition operations', () => {
  it('takes a type a capability of the server serves', () => {
    expect([refusalOf('echo'), refusalOf('probe')]).toEqual(['accepted', 'accepted']);
  });

  it('refuses a type no capability serves by naming the types of definition the server keeps, and a malformed one by its shape alone', () => {
    expect([refusalOf('prediction'), refusalOf('Echo!')]).toEqual([expect.any(String), expect.any(String)]);
  });
});

describe('the capability of a type', () => {
  it('is the capability that serves it, and not found for a type none serves', () => {
    expect(Effect.runSync(known.capabilityOfType('echo'))).toBe(echo);
    expect(Effect.runSync(Effect.flip(known.capabilityOfType('prediction')))).toEqual(
      new NotFound({ detail: 'There is no definition type prediction' }),
    );
  });
});

describe('how far a view lags the playbook', () => {
  it('is the time between the playbook’s newest record and the record at the checkpoint, unknown until both are known', () => {
    expect([
      lagOf('2026-10-06T10:02:05.000Z', '2026-10-06T10:00:05.000Z'),
      lagOf('2026-10-06T10:00:05.000Z', '2026-10-06T10:00:06.000Z'),
      lagOf('2026-10-06T10:00:05.000Z', null),
      lagOf(undefined, '2026-10-06T10:00:06.000Z'),
    ]).toEqual([120_000, 0, undefined, undefined]);
  });
});

describe('the standing of a view', () => {
  it('is rebuilding until a view of its version is kept', () => {
    expect([viewStandingOf(2), viewStandingOf(3, live, '2026-10-06T10:00:05.000Z')]).toEqual([
      {
        state: 'rebuilding',
        version: 2,
        checkpoint: null,
        checkpoint_at: null,
        folded: 0,
        lag_ms: null,
        newest_record_at: null,
      },
      {
        state: 'rebuilding',
        version: 3,
        checkpoint: null,
        checkpoint_at: null,
        folded: 0,
        lag_ms: null,
        newest_record_at: '2026-10-06T10:00:05.000Z',
      },
    ]);
  });

  it('says where the kept view stands, and why it stalled where it did', () => {
    const stall = {
      event: { id: 'event-2', type: 'run_succeeded', time: '2026-10-06T10:00:06.000Z' },
      kind: 'shape',
      message: 'The fold returned by_week, which data.views does not declare',
      line: null,
    };

    expect(viewStandingOf(2, live, '2026-10-06T10:00:07.000Z')).toEqual({
      state: 'live',
      version: 2,
      checkpoint: 'cursor',
      checkpoint_at: '2026-10-06T10:00:05.000Z',
      folded: 3,
      last_event: { id: 'event-1', time: '2026-10-06T10:00:04.000Z' },
      lag_ms: 2000,
      newest_record_at: '2026-10-06T10:00:07.000Z',
    });
    expect(viewStandingOf(2, { ...live, phase: 'stalled', lastEvent: null, stall })).toMatchObject({
      state: 'stalled',
      last_event: null,
      lag_ms: null,
      stalled: { event: stall.event, kind: 'shape', error: stall.message, line: null },
    });
  });
});
