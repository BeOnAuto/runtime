import { fileURLToPath } from 'node:url';

import { compileJsonSchema } from '@on.auto/json-schema';
import { InvalidInput } from '@on.auto/operations';
import { importedWithoutAnAddress, modulesReachedFrom } from '@on.auto/operations/testing';
import { Effect, Exit, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { checkedInput, outputShapeNamed, shapedViewsSchemaOf } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { fieldWords, refusalWordsOf } from '../testing/refusal-words.ts';
import * as checkedWorkerModule from './checked-worker.ts';
import { outputCheckOf, valueChecks, viewCheckOf } from './value-checks.ts';
import { checkedWorker } from './worker-url.ts';

const someWords: unknown = expect.any(String);

const categoriesSchema = outputShapeNamed('categories')?.schema ?? {};

function refused(tag: string, fields: object = {}): unknown {
  return expect.objectContaining({ _tag: tag, ...fields });
}

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-777777777772';

const tooFewSeats = { pointer: '/input/seats', detail: 'seats: expected at least 1.' };

const refusedRefusedInputKind = {
  reason: 'invalid_input',
  detail: tooFewSeats.detail,
  issues: [tooFewSeats],
  kind: 'input_schema',
};

async function playbookWithASeatedProbe() {
  const operations = definitionOperationsFor([probe().capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }),
  );
  const run = (seats: number) =>
    definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'probe', name: 'plain', input: { seats }, run_id: runId }),
    );
  const read = (operation: Parameters<typeof definitions.call>[0]) =>
    definitions.call(operation, toAlpha(acmeAdmin, { run_id: runId }));
  return { ...definitions, ...operations, run, read };
}

describe('the check of an output against the output schema', () => {
  it('names at most three issues of the output, each at its pointer', () => {
    const check = outputCheckOf({ type: 'array', items: { type: 'string' } });

    expect(check([1, 2, 3, 4])).toEqual([
      { pointer: '/0', detail: 'Expected string' },
      { pointer: '/1', detail: 'Expected string' },
      { pointer: '/2', detail: 'Expected string' },
    ]);
    expect(check(['x'])).toEqual([]);
  });

  it('checks an output against a shape its schema is with what the shape holds beyond its schema too', () => {
    const shaped = outputCheckOf(categoriesSchema);
    const twice = {
      values: [
        { name: 'a', value: 1 },
        { name: 'a', value: 2, low: 3 },
      ],
    };

    expect(shaped(twice)).toEqual([
      { pointer: '/values/1/name', detail: 'Expected a name no value before it has' },
      { pointer: '/values/1/low', detail: 'Expected a low of at most the value' },
    ]);
    expect(outputCheckOf({ type: 'object' })(twice)).toEqual([]);
  });

  it('names a string of the output out of the form its schema names', () => {
    const check = outputCheckOf({ type: 'object', properties: { due: { type: 'string', format: 'date' } } });

    expect([check({ due: '2026-04-01' }), check({ due: 'Friday' })]).toEqual([
      [],
      [{ pointer: '/due', detail: 'Expected a string in the format date, such as 2026-04-01' }],
    ]);
  });

  it('refuses every output when the schema it is given does not compile, naming why', () => {
    expect(outputCheckOf('not a schema')(1)).toEqual([{ pointer: '', detail: 'A schema is a JSON object' }]);
  });
});

describe('the check of a view against the view schema', () => {
  it('says nothing of a view that matches, and names where one does not in the one wording of the issues', () => {
    const check = viewCheckOf({ type: 'object', additionalProperties: { type: 'array', maxItems: 1 } });

    expect(check({ spring: [1] })).toBeUndefined();
    expect(check([])).toEqual({ kind: 'schema', detail: 'the view: Expected object' });
    expect(check({ spring: [1, 2], autumn: [1, 2] })).toEqual({
      kind: 'schema',
      detail:
        '/spring: Expected a value with a length of at most 1; /autumn: Expected a value with a length of at most 1',
    });
  });

  it('names an entry of the view out of the form its schema names', () => {
    const check = viewCheckOf({ type: 'object', additionalProperties: { type: 'string', format: 'date-time' } });

    expect([check({ spring: '2026-04-01T09:30:00Z' }), check({ spring: 'April' })]).toEqual([
      undefined,
      { kind: 'schema', detail: '/spring: Expected a string in the format date-time, such as 2026-04-01T09:30:00Z' },
    ]);
  });
});

describe('the check of the views of a page against their shapes', () => {
  const check = viewCheckOf(shapedViewsSchemaOf({ by_day: 'series', by_channel: 'categories' }));

  it('says nothing of views that match their shapes, or of views the fold has not given yet', () => {
    expect([
      check({}),
      check({ by_channel: { values: [{ name: 'LinkedIn', value: 3 }] } }),
      check({ by_day: { period: 'day', lines: [{ name: 'Posts', points: [{ at: '2026-11-01', value: 3 }] }] } }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it('stalls with the kind shape on a view that does not match, with the rules a shape adds to its schema', () => {
    const backwards = {
      period: 'day',
      lines: [
        {
          name: 'Posts',
          points: [
            { at: '2026-11-01', value: 3 },
            { at: '2026-10-31', value: 2 },
          ],
        },
      ],
    };

    expect(check({ by_day: backwards, by_channel: { values: [] } })).toEqual({
      kind: 'shape',
      detail:
        '/by_day/lines/0/points/1/at: Expected a time later than the point before it; /by_channel/values: Expected a value with a length of at least 1',
    });
  });

  it('stalls on views that are not an object, or that name a view data.views does not declare', () => {
    expect([check([]), check({ by_week: null })]).toEqual([
      { kind: 'shape', detail: someWords },
      { kind: 'shape', detail: someWords },
    ]);
  });
});

describe('the checked worker', () => {
  it('checks outputs and views with these checks, from a module that exports nothing and serves only in a worker', () => {
    expect([valueChecks.output, valueChecks.view]).toEqual([outputCheckOf, viewCheckOf]);
    expect(checkedWorker().pathname).toMatch(/\/checking\/checked-worker\.ts$/u);
    expect(Object.keys(checkedWorkerModule)).toEqual([]);
  });

  it('is named by a module that loads where import.meta.url names no file, read only as a pool makes the job', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./worker-url.ts', import.meta.url));

    expect(Object.keys(loaded)).toEqual(['checkedWorker']);
  });
});

describe('the checks of values, as the value-checks entry exports them', () => {
  it('reach no Node module and no compiler, so a pool on another platform checks outputs and views as the checked worker does', () => {
    const { packages } = modulesReachedFrom(fileURLToPath(new URL('..', import.meta.url)), 'checking/value-checks.ts');

    expect(packages).toEqual(['@on.auto/json-schema', '@on.auto/workflow-engine/worker']);
  });
});

describe('the check of the input of a run', () => {
  const booking = Result.getOrThrow(
    compileJsonSchema(
      {
        type: 'object',
        properties: { seats: { type: 'integer', minimum: 1 }, on: { type: 'string', format: 'date' } },
      },
      { what: 'input', nesting: 512 },
    ),
  );
  const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], 'x');

  it('takes an input its schema takes, and any input of a function without one, as it is', () => {
    expect([
      Effect.runSyncExit(checkedInput({ seats: 2, on: '2026-04-01' }, booking, 'booking function')),
      Effect.runSyncExit(checkedInput('anything', undefined, 'booking function')),
    ]).toEqual([Exit.succeed({ seats: 2, on: '2026-04-01' }), Exit.succeed('anything')]);
  });

  it('refuses an input its schema refuses in the words of its fields, of the kind input_schema, and one nested past a value, naming the noun', () => {
    expect([
      Effect.runSyncExit(checkedInput({ seats: 0 }, booking, 'booking function')),
      Effect.runSyncExit(checkedInput({ seats: 2, on: 'April' }, booking, 'booking function')),
      Effect.runSyncExit(checkedInput(deep, undefined, 'interaction function')),
    ]).toEqual([
      Exit.fail(
        new InvalidInput({
          detail: 'seats: expected at least 1.',
          issues: [{ pointer: '/seats', detail: 'seats: expected at least 1.' }],
          kind: 'input_schema',
        }),
      ),
      Exit.fail(
        new InvalidInput({
          detail: 'on: expected a date such as 2026-04-01.',
          issues: [{ pointer: '/on', detail: 'on: expected a date such as 2026-04-01.' }],
          kind: 'input_schema',
        }),
      ),
      Exit.fail(
        refused('invalid_input', {
          issues: [{ pointer: '', detail: 'Expected a value nested at most 512 levels deep' }],
        }),
      ),
    ]);
  });
});

describe('the words of a string out of its form', () => {
  it('says the form a field takes and an example of it, as the bounds are said', () => {
    expect([
      fieldWords({ type: 'string', format: 'date' }, 'April'),
      fieldWords({ type: 'string', format: 'date-time' }, 'April 1st, 9:30'),
      fieldWords({ type: 'string', format: 'time' }, 'half past nine'),
      fieldWords({ type: 'string', format: 'email' }, 'ada'),
      fieldWords({ type: 'string', format: 'uri' }, 'example.com'),
      fieldWords({ type: 'string', format: 'uuid' }, '42'),
    ]).toEqual([
      'field: expected a date such as 2026-04-01.',
      'field: expected a date and time such as 2026-04-01T09:30:00Z.',
      'field: expected a time such as 09:30:00Z.',
      'field: expected an email address such as name@example.com.',
      'field: expected a URI such as https://example.com.',
      'field: expected a UUID such as 0f8fad5b-d9cb-469f-a165-70867728950e.',
    ]);
  });

  it('keeps the description and the examples of the field before the form, and says a name out of its form', () => {
    expect([
      fieldWords({ type: 'string', format: 'date', description: 'The day the order is due' }, 'Friday'),
      fieldWords({ type: 'string', minLength: 12, format: 'date' }, 'Friday'),
      fieldWords({ type: 'object', propertyNames: { format: 'date' } }, { soon: 1 }),
    ]).toEqual([
      'field, The day the order is due: expected a date such as 2026-04-01.',
      'field: expected at least 12 characters. field: expected a date such as 2026-04-01.',
      'the name soon of field: expected a date such as 2026-04-01.',
    ]);
  });

  it('leaves the example of the form out where the field gives its own, in its examples or its description', () => {
    expect([
      fieldWords({ type: 'string', format: 'date', examples: ['2026-05-01'] }, 'Friday'),
      fieldWords({ type: 'string', format: 'date', description: 'The day, such as 2026-05-01' }, 'Friday'),
      fieldWords(
        { type: 'object', description: 'Totals by day, such as 2026-05-01', propertyNames: { format: 'date' } },
        { soon: 1 },
      ),
      refusalWordsOf({ type: 'string', format: 'date', examples: ['2026-05-01'] }, 'Friday'),
    ]).toEqual([
      'field, such as “2026-05-01”: expected a date.',
      'field, The day, such as 2026-05-01: expected a date.',
      'the name soon of field, Totals by day, such as 2026-05-01: expected a date.',
      'The input: expected a date such as 2026-04-01.',
    ]);
  });
});

describe('a run whose input its input schema refused', () => {
  it('is rejected of the kind input_schema, which get_run shows and a retry under its run id answers again', async () => {
    const { run, read, getRun } = await playbookWithASeatedProbe();

    const ran = await run(0);
    const retried = await run(0);

    expect(ran).toEqual({ status: 'rejected', ...refusedRefusedInputKind });
    expect(retried).toEqual(ran);
    expect(await read(getRun)).toMatchObject({ output: { status: 'rejected', rejection: refusedRefusedInputKind } });
  });

  it('is listed with the kind beside its reason, and its history shows the kind and says it in words', async () => {
    const { run, read, call, listRuns, getRunHistory } = await playbookWithASeatedProbe();
    await run(0);

    expect(await call(listRuns, toAlpha(acmeAdmin, {}))).toMatchObject({
      output: { runs: [{ run_id: runId, rejection: { reason: 'invalid_input', kind: 'input_schema' } }] },
    });
    expect(await read(getRunHistory)).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          {
            type: 'run_rejected',
            summary: someWords,
            data: { ...refusedRefusedInputKind, issue_count: 1 },
          },
        ],
      },
    });
  });

  it('runs on an input its input schema takes', async () => {
    const { run } = await playbookWithASeatedProbe();

    expect(await run(2)).toMatchObject({ output: { status: 'succeeded', output: { seats: 2 } } });
  });
});
