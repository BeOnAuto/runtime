import { playbookCallerOf } from '@on.auto/operations';
import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Capability } from '../capability/capability.ts';
import { defineCapability, defineStartVersion, type RunContext } from '../index.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { acmeAdmin, startedInAlpha } from '../testing/callers.ts';
import { echo, echoDeclaration } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, type Harness, runStreamIn, toPlaybook } from '../testing/harness.ts';
import {
  askedAt,
  keepingPlaybook,
  keptArmOfText,
  keptFunctionName,
  runsStartedIn,
  twoHoursLater,
} from '../testing/kept-documents.ts';
import { keptArmOf, keptIn, keptLongBeforeAndLost, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';
import { admittingMeter } from '../testing/recording-meter.ts';
import {
  functionDocumentLongerThanAFactHolds,
  longerThanAFactHolds,
  savingAFunction,
  savingOperations,
} from '../testing/saved-definitions.ts';
import { definitionOf, listedDefinitionOf } from './answered-definitions.ts';

const someWords: unknown = expect.any(String);

const { createDefinition, runDefinition, getRun } = definitionOperationsFor([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const input = { who: 'Ada' };

const output = { greeting: 'Hi', input, letter: 'x'.repeat(4096) };

const kept = keptArmOf(output);

const onTheRun = {
  runId,
  by: 'acme-admin',
  at: firstMoment,
  definitionType: 'echo',
  definitionName: 'greet',
  definitionVersion: 1,
};

async function withAKeptOutput(keeps: boolean) {
  const watched = watchedStore();
  const definitions = harness(admittingMeter, watched.store);
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  const { service } = definitions.ledger;
  await Effect.runPromise(
    Effect.all([
      keeps
        ? keptIn(service.content, alpha, output)
        : keptLongBeforeAndLost(service.content, watched.store, alpha, output),
      recordedAsGiven(
        service,
        runStreamIn(definitions.ledger, { type: 'echo', name: 'greet' }, runId),
        [
          { type: 'run_started', data: { input, ...startedInAlpha } },
          { type: 'run_succeeded', data: { output_sha256: kept.sha256, output_bytes: kept.bytes, record: {} } },
        ],
        onTheRun,
      ),
    ]),
  );
  return { definitions, watched };
}

const succeeded = { run_id: runId, type: 'echo', name: 'greet', status: 'succeeded' };

const answeringAtItsLimit = defineCapability({
  ...echoDeclaration,
  type: 'limited',
  run: ({ greeting }, inputAnswersAtLimit) =>
    Effect.succeed({
      output: { greeting, input: inputAnswersAtLimit },
      record: { greeting },
      incomplete_details: { reason: 'max_tool_calls' as const },
    }),
});

const promptedAtItsLimit = defineCapability({
  ...echoDeclaration,
  type: 'prompted-limited',
  run: ({ greeting }, inputAnswersAtLimit) =>
    Effect.succeed({
      output: { greeting },
      record: { greeting, prompt: inputAnswersAtLimit },
      incomplete_details: { reason: 'max_input_tokens' as const },
    }),
});

const {
  createDefinition: createDefinitionInAnswersAtLimit,
  runDefinition: runDefinitionInAnswersAtLimit,
  getRun: getRunInAnswersAtLimit,
  listRuns,
} = definitionOperationsFor([answeringAtItsLimit, promptedAtItsLimit]);

const answered = { incomplete_details: { reason: 'max_tool_calls' } };

async function limited(type = 'limited'): Promise<Harness> {
  const definitions = harness(admittingMeter, watchedStore().store);
  await definitions.call(
    createDefinitionInAnswersAtLimit,
    toAlpha(acmeAdmin, { type, name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  return definitions;
}

function ranWith(inputAnswersAtLimit: object, type = 'limited') {
  return toAlpha(acmeAdmin, { type, name: 'greet', input: inputAnswersAtLimit, run_id: runId });
}

async function factsOf(definitions: Harness) {
  const { records } = await Effect.runPromise(
    definitions.ledger.service.readRecorded(alpha, { kind: 'run', run: runId }, { order: 'asc', limit: 10 }),
  );
  return records.map(({ type, data }) => ({ type, data }));
}

const longestPostMs = 70_000;

const posting = defineCapability({
  type: 'posting',
  title: 'Posting',
  guide: { name: 'posting' },
  noun: { one: 'post', other: 'posts' },
  describeOutput: () => 'It posted.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.succeed({ output: null, record: {} }),
  longestRunOf: () => longestPostMs,
});

function measuringInto(remembered: (run: RunContext) => void) {
  return defineCapability({
    type: 'measuring',
    title: 'Measuring',
    guide: { name: 'measuring' },
    noun: { one: 'measure', other: 'measures' },
    describeOutput: () => 'It measured.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    run: (_source, _input, run) =>
      Effect.gen(function* () {
        remembered(run);
        const longest = [yield* run.longestRunOf('posting', 'post'), yield* run.longestRunFor('posting', 'post', {})];
        return { output: { longest: longest.map((ms) => ms ?? null) }, record: {} };
      }),
  });
}

const longPost = longerThanAFactHolds('Post to the channel the playbook names.');

async function measuredWhere({ readable }: { readonly readable: boolean }) {
  const watched = watchedStore();
  const definitions = harness(undefined, watched.store);
  const contexts: RunContext[] = [];
  const operations = definitionOperationsFor([
    measuringInto((run) => {
      contexts.push(run);
    }),
    posting,
  ]);
  const saved = (type: string, name: string, source: string) =>
    definitions.run(
      definitions
        .dispatch(operations.createDefinition, toAlpha(acmeAdmin, { type, name, source }))
        .pipe(Effect.provideService(PayloadOffloading, true)),
    );
  await saved('posting', 'post', longPost);
  await saved('measuring', 'calls', 'Measures the post it calls');
  if (!readable) {
    watched.fail();
  }
  const answeredKeptCalledMeasures = await definitions.call(
    operations.runDefinition,
    toAlpha(acmeAdmin, { type: 'measuring', name: 'calls' }),
  );
  return { answered: answeredKeptCalledMeasures, reads: watched.reads(), contexts };
}

const {
  createDefinition: createDefinitionInKeptDocumentRuns,
  runDefinition: runDefinitionInKeptDocumentRuns,
  getRun: getRunInKeptDocumentRuns,
} = savingOperations;

const first = { source: functionDocumentLongerThanAFactHolds('Hi'), overview: 'Greets each guest', diagram: 'none' };

const theKeptFunction = { type: savingAFunction.type, name: keptFunctionName };

const notStarted: unknown = expect.stringContaining('could not be read just now, so no run started');

const decodeRunId = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ run_id: Schema.String }) }),
);

const { createDefinition: createDefinitionInKeptStartOnce } = definitionOperationsFor([echo]);

const startVersion = defineStartVersion([echo]);

const inputKeptStartOnce = { who: 'Ada', notes: 'n'.repeat(3000) };

const keptKeptStartOnce = keptArmOf(inputKeptStartOnce);

const onTheRunKeptStartOnce = {
  runId,
  by: 'acme-admin',
  at: firstMoment,
  definitionType: 'echo',
  definitionName: 'greet',
};

async function endedUnworkedWithAKeptInput() {
  const watched = watchedStore();
  const definitions = harness(admittingMeter, watched.store);
  await definitions.call(
    createDefinitionInKeptStartOnce,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  const { service } = definitions.ledger;
  await Effect.runPromise(keptIn(service.content, alpha, inputKeptStartOnce));
  await Effect.runPromise(
    recordedAsGiven(
      service,
      runStreamIn(definitions.ledger, { type: 'echo', name: 'greet' }, runId),
      [
        {
          type: 'run_started',
          data: {
            input_sha256: keptKeptStartOnce.sha256,
            input_bytes: keptKeptStartOnce.bytes,
            ...startedInAlpha,
          },
        },
        { type: 'run_rejected', data: { rejection: { reason: 'unavailable', detail: 'Busy' } } },
      ],
      { ...onTheRunKeptStartOnce, definitionVersion: 1 },
    ),
  );
  return { definitions, watched };
}

function startedOnceWith(given: object) {
  return toAlpha(playbookCallerOf(alpha), { type: 'echo', name: 'greet', version: 1, input: given, run_id: runId });
}

const document = JSON.stringify({ greeting: 'Hi', description: 'Greets', notes: 'n'.repeat(3000) });

function readingOnce(): { readonly capability: Capability; readonly reads: () => number } {
  const reading = defineCapability({
    ...echoDeclaration,
    parse: () => Effect.succeed({ greeting: 'Hi' }),
    summarize: (parsed) => ({ ...echoDeclaration.summarize(parsed), warnings: ['Found on reading'] }),
  });
  let reads = 0;
  return {
    capability: {
      ...reading,
      prepare: (source, stripped) => {
        reads += 1;
        return reading.prepare(source, stripped);
      },
    },
    reads: () => reads,
  };
}

const stored: StoredDefinition = {
  name: 'greeter',
  definition_id: 'id-of-greeter',
  version: 1,
  status: 'active',
  source: { kept: keptArmOfText(document) },
  warnings: ['A warning of the parser that saved it'],
  created_at: firstMoment,
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: firstMoment,
};

describe('a run whose output its playbook keeps outside the run', () => {
  it('is answered by get_run with its output, read once from the content of its playbook', async () => {
    const { definitions, watched } = await withAKeptOutput(true);

    expect(await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'succeeded',
      output: { ...succeeded, output },
    });
    expect(watched.reads()).toBe(1);
  });

  it('is answered by run_definition, asked again with its id and input, with its output read', async () => {
    const { definitions } = await withAKeptOutput(true);

    expect(
      await definitions.call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input, run_id: runId })),
    ).toMatchObject({ status: 'succeeded', output: { ...succeeded, output } });
  });

  it('is answered with the digest and size of an output its playbook no longer holds, in place of the output', async () => {
    const { definitions } = await withAKeptOutput(false);
    const answeredKeptRunAnswers = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));

    expect(answeredKeptRunAnswers).toMatchObject({
      status: 'succeeded',
      output: { ...succeeded, output_sha256: kept.sha256, output_bytes: kept.bytes },
    });
    expect(answeredKeptRunAnswers).not.toHaveProperty('output.output');
  });

  it('is unavailable, to be asked again, while the store of its content does not answer', async () => {
    const { definitions, watched } = await withAKeptOutput(true);
    watched.fail();

    expect(await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail: someWords,
    });
  });
});

describe('a run whose capability answers with the limit its answer was shaped by', () => {
  it('records the limit on run_succeeded beside its output, and get_run and list_runs read it back', async () => {
    const definitions = await limited();

    expect(await definitions.call(runDefinitionInAnswersAtLimit, ranWith({ who: 'Ada' }))).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, status: 'succeeded', output: { greeting: 'Hi' }, ...answered },
    });
    expect(await factsOf(definitions)).toEqual([
      { type: 'run_started', data: { input: { who: 'Ada' }, ...startedInAlpha } },
      {
        type: 'run_succeeded',
        data: { output: { greeting: 'Hi', input: { who: 'Ada' } }, record: { greeting: 'Hi' }, ...answered },
      },
    ]);
    expect([
      await definitions.call(getRunInAnswersAtLimit, toAlpha(acmeAdmin, { run_id: runId })),
      await definitions.call(listRuns, toAlpha(acmeAdmin)),
    ]).toMatchObject([{ output: answered }, { output: { runs: [answered] } }]);
  });

  it('keeps the limit on the fact when its output is kept outside it', async () => {
    const definitions = await limited();
    const inputAnswersAtLimit = { who: 'Ada', notes: 'n'.repeat(17_000) };
    const keptAnswersAtLimit = keptArmOf({ greeting: 'Hi', input: inputAnswersAtLimit });

    await definitions.run(
      definitions
        .dispatch(runDefinitionInAnswersAtLimit, ranWith(inputAnswersAtLimit))
        .pipe(Effect.provideService(PayloadOffloading, true)),
    );

    expect((await factsOf(definitions)).at(-1)).toEqual({
      type: 'run_succeeded',
      data: {
        output_sha256: keptAnswersAtLimit.sha256,
        output_bytes: keptAnswersAtLimit.bytes,
        record: { greeting: 'Hi' },
        ...answered,
      },
    });
  });
});

describe('a run that answered at its limit with a prompt past 16,384 bytes, where its playbook keeps large values outside its runs', () => {
  it('keeps its prompt by digest, as any run that succeeded does, with the limit beside it', async () => {
    const definitions = await limited('prompted-limited');
    const prompt = { message: 'm'.repeat(17_000), truncated: false };
    const keptAnswersAtLimit = keptArmOf(prompt);
    const atItsBudget = { incomplete_details: { reason: 'max_input_tokens' } };

    const ran = await definitions.run(
      definitions
        .dispatch(runDefinitionInAnswersAtLimit, ranWith(prompt, 'prompted-limited'))
        .pipe(Effect.provideService(PayloadOffloading, true)),
    );

    expect((await factsOf(definitions)).at(-1)).toEqual({
      type: 'run_succeeded',
      data: {
        output: { greeting: 'Hi' },
        record: { greeting: 'Hi', prompt_sha256: keptAnswersAtLimit.sha256, prompt_bytes: keptAnswersAtLimit.bytes },
        ...atItsBudget,
      },
    });
    expect([ran, await definitions.call(getRunInAnswersAtLimit, toAlpha(acmeAdmin, { run_id: runId }))]).toMatchObject([
      { status: 'succeeded', output: { record: { greeting: 'Hi', prompt }, ...atItsBudget } },
      { status: 'succeeded', output: { record: { greeting: 'Hi', prompt }, ...atItsBudget } },
    ]);
  });
});

describe('a run that measures a definition it calls, whose document its playbook keeps outside its facts', () => {
  it('reads that document for each measure and is given the bound its capability declares', async () => {
    expect(await measuredWhere({ readable: true })).toMatchObject({
      answered: { status: 'succeeded', output: { output: { longest: [longestPostMs, longestPostMs] } } },
      reads: 2,
    });
  });

  it('is measured wherever the measure is asked, needing nothing from the run that asks', async () => {
    const { contexts } = await measuredWhere({ readable: true });

    expect(await Effect.runPromise(Effect.forEach(contexts, (run) => run.longestRunOf('posting', 'post')))).toEqual([
      longestPostMs,
    ]);
  });

  it('is given no measure while that document cannot be read, and runs all the same', async () => {
    expect(await measuredWhere({ readable: false })).toMatchObject({
      answered: { status: 'succeeded', output: { output: { longest: [null, null] } } },
    });
  });
});

describe('a run of a definition whose document its playbook keeps outside its facts', () => {
  it('reads the document once to start, and starts nothing while it cannot be read', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await asked(createDefinitionInKeptDocumentRuns, first);

    expect(await asked(runDefinitionInKeptDocumentRuns, { input: { who: 'Ada' } })).toMatchObject({
      status: 'succeeded',
    });
    expect(watched.reads()).toBe(1);
    watched.fail();
    expect(await asked(runDefinitionInKeptDocumentRuns, { input: { who: 'Grace' } })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'content_unavailable',
      detail: notStarted,
    });
    expect(await runsStartedIn(definitions)).toBe(1);
  });

  it('is refused, saying the document is gone and to update the definition, once it is gone', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await asked(createDefinitionInKeptDocumentRuns, first);
    watched.lose();

    expect(
      await askedAt(definitions, twoHoursLater)(runDefinitionInKeptDocumentRuns, {
        ...theKeptFunction,
        input: { who: 'Grace' },
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      because: 'function_document_missing',
      detail: someWords,
    });
  });

  it('is answered with its page, which says why it cannot be shown once the document it renders from is gone', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await asked(createDefinitionInKeptDocumentRuns, first);
    const ran = decodeRunId(await asked(runDefinitionInKeptDocumentRuns, { input: { who: 'Ada' } }));
    watched.lose();
    const bytes = keptArmOfText(first.source).bytes.toLocaleString('en-US');

    expect(
      await askedAt(definitions, twoHoursLater)(getRunInKeptDocumentRuns, { run_id: ran.output.run_id }),
    ).toMatchObject({
      status: 'succeeded',
      output: {
        page: {
          result: `The page of reasoning/greet-reasoning could not be shown: its document, ${bytes} bytes, is missing from the playbook's content.`,
        },
      },
    });
  });
});

describe('a start made once of a run that ended unworked with an input its playbook keeps outside it', () => {
  it('reads the recorded input only once the decider cannot tell, and starts again for the same input in another order', async () => {
    const { definitions, watched } = await endedUnworkedWithAKeptInput();
    const reordered = { notes: inputKeptStartOnce.notes, who: inputKeptStartOnce.who };

    expect(await definitions.call(startVersion, startedOnceWith(reordered))).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: { greeting: 'Hi', input: reordered } },
    });
    expect(watched.reads()).toBe(1);
  });

  it('reads nothing where the text is the same, the digest telling it', async () => {
    const { definitions, watched } = await endedUnworkedWithAKeptInput();

    expect(await definitions.call(startVersion, startedOnceWith(inputKeptStartOnce))).toMatchObject({
      status: 'succeeded',
    });
    expect(watched.reads()).toBe(0);
  });

  it('loads the stream of the run only where the decider cannot tell, so a start it can tell loads none', async () => {
    const told = await endedUnworkedWithAKeptInput();
    const untold = await endedUnworkedWithAKeptInput();

    await told.definitions.call(startVersion, startedOnceWith(inputKeptStartOnce));
    await untold.definitions.call(
      startVersion,
      startedOnceWith({ notes: inputKeptStartOnce.notes, who: inputKeptStartOnce.who }),
    );

    expect(told.definitions.ledgerReads()).not.toContainEqual({
      loaded: runStreamIn(told.definitions.ledger, { type: 'echo', name: 'greet' }, runId),
    });
    expect(untold.definitions.ledgerReads()).toContainEqual({
      loaded: runStreamIn(untold.definitions.ledger, { type: 'echo', name: 'greet' }, runId),
    });
  });
});

describe('the warnings of a definition whose document its playbook keeps outside its fact, listed', () => {
  it('are those found when its document was last read here, known by its digest, or else those it was saved with, with no read of the store', async () => {
    const { capability, reads } = readingOnce();

    const before = await Effect.runPromise(listedDefinitionOf(capability, stored));
    await Effect.runPromise(definitionOf(capability, stored, { source: document }));
    const after = await Effect.runPromise(listedDefinitionOf(capability, stored));

    expect([before.warnings, after.warnings]).toEqual([
      ['A warning of the parser that saved it'],
      ['Found on reading'],
    ]);
    expect(reads()).toBe(1);
  });
});
