import { InvalidInput } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  defineRunDefinition,
  defineCapability,
  type AnswerIssues,
  type RunContext,
  type CapabilityDeclaration,
} from '../index.ts';
import { recordingJournal } from '../journal-testing/recording-journal.ts';
import { answeringLaterMs, answeringNowMs, asking, nudgesPresenter } from '../testing/asking.ts';
import { noCalledDefinitions } from '../testing/called-definitions.ts';

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
  definition: { name: 'count', version: 3 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
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
  it('reaches systems outside the server only when it says so, and so does run_definition when one of its capabilities does', () => {
    const local = defineCapability(words);
    const outside = defineCapability({ ...words, type: 'lookup', reachesOutside: true });

    expect([local.reachesOutside, outside.reachesOutside]).toEqual([false, true]);
    expect([
      defineRunDefinition([local]).registration.reachesOutside,
      defineRunDefinition([local, outside]).registration.reachesOutside,
    ]).toEqual([false, true]);
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

const countedOnly: AnswerIssues = (answer, { work }) =>
  work.some(({ data }) => data['word'] === answer)
    ? []
    : [{ pointer: '', detail: `${JSON.stringify(answer)} was not counted` }];

describe('the answer a run takes', () => {
  it('is any answer its request takes, unless the capability names issues of it against the run as it stands', () => {
    const answering = {
      work: [{ type: 'counted', data: { word: 'one' }, at: '2026-10-01T09:00:00.000Z' }],
    };
    const checking = defineCapability({ ...words, answerIssues: countedOnly });

    expect([
      defineCapability(words).answerIssues('two', answering),
      checking.answerIssues('one', answering),
      checking.answerIssues('two', answering),
    ]).toEqual([[], [], [{ pointer: '', detail: '"two" was not counted' }]]);
  });
});
