import { beforeGoingOnOf, type Notice } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability } from '../capability/capability.ts';
import { publishedOutputOf } from '../index.ts';
import { DefinitionTextUnread } from '../payloads/kept-texts.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, harness, toPlaybook } from '../testing/harness.ts';
import { shapeNamed } from '../testing/shapes.ts';
import { refusedToAnswerFor, refusedToRunFor } from './unread-texts.ts';

const { createDefinition, runDefinition, getRun } = definitionOperationsFor([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function withRun() {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  await definitions.call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: runId }));
  return definitions;
}

const checkIt: Notice = { kind: 'checked', detail: 'Its run read only; check it.', at: '/tools', certainty: 'likely' };

function recordingCapability() {
  return defineCapability({
    type: 'recorded',
    title: 'Recorded',
    guide: { name: 'recorded' },
    noun: { one: 'recorded function', other: 'recorded functions' },
    describeOutput: () => 'It answered its document.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed({ text: source }),
    summarize: ({ text }) => ({ description: text }),
    run: ({ text }) =>
      Effect.succeed({
        output: text,
        record: text === 'noticed' ? { notices: [checkIt, checkIt, checkIt, checkIt] } : {},
      }),
  });
}

async function ranAs(source: string) {
  const operations = definitionOperationsFor([recordingCapability()]);
  const { call } = harness();
  await call(operations.createDefinition, toAlpha(acmeAdmin, { type: 'recorded', name: 'judge', source }));
  const ran = await call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'recorded', name: 'judge' }));
  return { ran, call, operations };
}

const texts = defineCapability({
  type: 'texts',
  title: 'Texts',
  guide: { name: 'texts' },
  noun: { one: 'text', other: 'texts' },
  describeOutput: () => 'It answered.',
  mediaType: 'text/plain',
  parse: (source) => Effect.succeed(source),
  summarize: () => publishedOutputOf({ shape: shapeNamed('text') }),
  answersItsShapeFor: (_source, input) => input !== 'plainly',
  run: (source, input) => Effect.succeed({ output: input === 'plainly' ? source : { text: source }, record: {} }),
});

const {
  createDefinition: createDefinitionInRunShapes,
  runDefinition: runDefinitionInRunShapes,
  getRun: getRunInRunShapes,
  listRuns,
} = definitionOperationsFor([echo, texts]);

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      runs: Schema.Array(Schema.Struct({ run_id: Schema.String, output_shape: Schema.optionalKey(Schema.String) })),
    }),
  }),
);

const runs = {
  shaped: '0199a3c4-7d2e-7c1a-9b3f-777777777771',
  plain: '0199a3c4-7d2e-7c1a-9b3f-777777777772',
  unshaped: '0199a3c4-7d2e-7c1a-9b3f-777777777773',
};

async function withThreeRuns() {
  const definitions = harness();
  await definitions.call(
    createDefinitionInRunShapes,
    toAlpha(acmeAdmin, { type: 'texts', name: 'note', source: 'Hello' }),
  );
  await definitions.call(
    createDefinitionInRunShapes,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  await definitions.call(
    runDefinitionInRunShapes,
    toAlpha(acmeAdmin, { type: 'texts', name: 'note', run_id: runs.shaped }),
  );
  await definitions.call(
    runDefinitionInRunShapes,
    toAlpha(acmeAdmin, { type: 'texts', name: 'note', input: 'plainly', run_id: runs.plain }),
  );
  await definitions.call(
    runDefinitionInRunShapes,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: runs.unshaped }),
  );
  return definitions;
}

const someWords: unknown = expect.any(String);

const greet = { name: 'greet', version: 3 };

describe('get_run', () => {
  it('reads a run by its id in any case, from JSON and from a query string', async () => {
    const { call } = await withRun();
    const found = { status: 'succeeded', output: { run_id: runId, status: 'succeeded' } };

    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId.toUpperCase() }))).toMatchObject(found);
    expect(await call(getRun, asQueryString(toAlpha(acmeAdmin, { run_id: runId })))).toMatchObject(found);
  });
});

describe('get_run rejecting', () => {
  it('an id the playbook has no run for', async () => {
    const { call } = await withRun();
    const unknownId = '0199a3c4-7d2e-7c1a-9b3f-000000000000';

    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: unknownId }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: `There is no run ${unknownId} in this playbook`,
    });
  });

  it('an id that is not a UUID and a field the operation does not know', async () => {
    expect(await harness().call(getRun, toAlpha(acmeAdmin, { run_id: 'latest', type: 'echo' }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/type' }, { pointer: '/run_id', detail: 'Expected a UUID' }],
    });
  });
});

describe('a run a step of a workflow started', () => {
  it('names the workflow run and the step it is within, as run_definition answered it, and a run no step started does not', async () => {
    const definitions = await withRun();
    const workflowRun = '0199a3c4-7d2e-7c1a-9b3f-000000000001';
    const stepRun = '0199a3c4-7d2e-7c1a-9b3f-000000000002';
    const within = { run_id: workflowRun, step: 'do/0/fork/branches/1/greet' };

    const answered = await definitions.call(runDefinition, {
      ...toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: stepRun }),
      calledBy: { run_id: workflowRun, reference: '/do/0/fork/branches/1/greet', run: 1 },
    });
    const read = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: stepRun }));
    const notWithin = await definitions.call(getRun, toAlpha(acmeAdmin, { run_id: runId }));

    expect([answered, read]).toMatchObject([
      { status: 'succeeded', output: { run_id: stepRun, within } },
      { status: 'succeeded', output: { run_id: stepRun, within } },
    ]);
    expect(notWithin).toMatchObject({ status: 'succeeded', output: { run_id: runId } });
    expect(notWithin).not.toHaveProperty('output.within');
  });
});

describe('the answer of a run the agent asked for', () => {
  it('carries the notices its record holds, at most three, and what to do with them', async () => {
    const { ran } = await ranAs('noticed');

    expect(ran).toMatchObject({
      status: 'succeeded',
      output: { output: 'noticed', record: { notices: [checkIt, checkIt, checkIt, checkIt] } },
    });
    expect(ran).toMatchObject({
      output: { notices: [checkIt, checkIt, checkIt], before_going_on: beforeGoingOnOf(3) },
    });
  });

  it('carries none when its record holds none', async () => {
    const { ran } = await ranAs('plain');

    expect(ran).toMatchObject({ status: 'succeeded', output: { output: 'plain' } });
    expect(JSON.stringify(ran)).not.toContain('notices');
  });
});

describe('the shape of the output of a run', () => {
  it('is the shape its definition declares, for a run of the kind that answers it', async () => {
    const { call } = await withThreeRuns();

    expect(await call(getRunInRunShapes, toAlpha(acmeAdmin, { run_id: runs.shaped }))).toMatchObject({
      output: { run_id: runs.shaped, status: 'succeeded', output_shape: 'text', output: { text: 'Hello' } },
    });
  });

  it('is left out of a run of a kind that answers no shape, and of a run whose definition declares none', async () => {
    const { call } = await withThreeRuns();
    const plain = await call(getRunInRunShapes, toAlpha(acmeAdmin, { run_id: runs.plain }));
    const unshaped = await call(getRunInRunShapes, toAlpha(acmeAdmin, { run_id: runs.unshaped }));

    expect([plain, unshaped]).toMatchObject([{ output: { status: 'succeeded' } }, { output: { status: 'succeeded' } }]);
    expect(plain).not.toHaveProperty('output.output_shape');
    expect(unshaped).not.toHaveProperty('output.output_shape');
  });

  it('is listed with the run', async () => {
    const { call } = await withThreeRuns();
    const { output } = decodeListed(await call(listRuns, toAlpha(acmeAdmin, {})));

    expect(output.runs).toEqual([
      { run_id: runs.unshaped },
      { run_id: runs.plain },
      { run_id: runs.shaped, output_shape: 'text' },
    ]);
  });
});

describe('a text of a definition the store does not give just now', () => {
  const unread = new DefinitionTextUnread({ name: 'source', because: 'unavailable' });

  it('says a pause, a resumption, a retirement and a restoration it made are saved and shown once storage responds', () => {
    expect([
      refusedToAnswerFor('workflow', greet, 'paused')(unread).detail,
      refusedToAnswerFor('workflow', greet, 'resumed')(unread).detail,
      refusedToAnswerFor('reasoning', greet, 'retired')(unread).detail,
      refusedToAnswerFor('reasoning', greet, 'restored')(unread).detail,
    ]).toEqual([expect.any(String), expect.any(String), expect.any(String), expect.any(String)]);
  });

  it('says a definition created or saved, and one only read, as before', () => {
    expect([
      refusedToAnswerFor('workflow', greet, 'created')(unread).detail,
      refusedToAnswerFor('workflow', greet, 'saved')(unread).detail,
      refusedToAnswerFor('workflow', greet)(unread).detail,
    ]).toEqual([expect.any(String), expect.any(String), expect.any(String)]);
  });
});

describe('a text of a definition its playbook erased', () => {
  it('refuses a run of its version, and an answer that would hold it, saying it was erased and how to save it again', () => {
    const erased = new DefinitionTextUnread({ name: 'overview', because: 'erased' });

    expect([
      refusedToRunFor('workflow', greet)(new DefinitionTextUnread({ name: 'source', because: 'erased' })),
      refusedToAnswerFor('workflow', greet)(erased),
      refusedToAnswerFor('workflow', greet, 'paused')(erased),
    ]).toMatchObject([
      {
        _tag: 'conflict',
        because: 'workflow_document_missing',
        detail: someWords,
      },
      {
        _tag: 'conflict',
        kind: 'unworkable',
        detail: someWords,
      },
      {
        _tag: 'conflict',
        kind: 'unworkable',
        detail: someWords,
      },
    ]);
  });
});
