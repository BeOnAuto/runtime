import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import { mostExpressionWork, mostHeldBytes } from '../machine/limits.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { argumentTextOf } from './argument-texts.ts';
import { expressionUnitOf } from './expression-units.ts';
import { filterContextOf } from './kept-contexts.ts';
import { moduleRun, type ModuleRun } from './module-runs.ts';
import type { Evaluation, ProgramRun } from './program-run.ts';
import { threadStackBytes, unitMemoryBytes } from './sandbox-bounds.ts';

const evaluation: Evaluation = { budget: mostExpressionWork, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const settings = { stackBytes: threadStackBytes, mostAnswerBytes: unitMemoryBytes, clock: () => 0 };

const photo = {
  id: '019a5b12-0000-7000-8000-000000000091',
  media_type: 'image/png',
  bytes: 4,
  sha256: 'd'.repeat(64),
  address: null,
  address_until: null,
};

function answerOf(run: ProgramRun | ModuleRun): unknown {
  return run.ran === 'answered' ? JSON.parse(run.text) : run.ran;
}

function detailOf(run: ProgramRun): string {
  return run.ran === 'answered' ? run.text : run.issue.detail;
}

const rows = Array.from({ length: 8000 }, (_, index) => ({
  id: index,
  name: `Name ${index}`,
  email: `c${index}@example.com`,
  amount: index * 3,
  place: { city: 'Delft', code: `26${index % 100}` },
}));

function numbers(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index % 100);
}

const asMuchAsARunHolds = Array.from({ length: Math.floor((mostHeldBytes - 13) / 3) }, () => 10);

interface Charged {
  readonly expression: string;
  readonly data: Json;
  readonly work: number;
}

const chargedBeforeTheGuard: readonly Charged[] = [
  { expression: '$data.rows.length + 1', data: { rows }, work: 0 },
  { expression: '$data.rows.filter((row) => row.amount > 12000).length', data: { rows }, work: 0 },
  { expression: '$data.numbers.length + 1', data: { numbers: numbers(200_000) }, work: 0 },
  { expression: '$data.numbers.reduce((sum, each) => sum + each, 0)', data: { numbers: numbers(200_000) }, work: 20 },
  { expression: '$data.numbers.length + 1', data: { numbers: numbers(800_000) }, work: 0 },
  { expression: '$data.numbers.length', data: { numbers: asMuchAsARunHolds }, work: 0 },
];

const writingAsText = ['`${$data.photo}`', "'' + $data.photo", '$data.photo.toString()', '$data.photo.valueOf()'];

describe.each(sourcesUnderTest)('an asset an expression is given, on $name instances', ({ source }) => {
  it('is passed on whole, and its own members, its keys and its JSON are read as they are', async () => {
    const instance = await source(unitMemoryBytes);
    const unit = expressionUnitOf(() => instance, settings);
    const given = { data: { photo, list: [photo] } };

    const answers = [
      '$data.photo',
      '$data.list[0].media_type',
      'Object.keys($data.photo).length',
      'JSON.stringify($data.photo) === JSON.stringify($data.list[0])',
      "'id' in $data.photo",
    ].map((expression) => answerOf(unit.evaluate(expression, given, evaluation)));
    unit.close();

    expect(answers).toEqual([photo, 'image/png', 6, true, true]);
  });

  it('is read as data by a program, which is a function that reads it', async () => {
    const run = moduleRun(await source(unitMemoryBytes), settings, {
      source: 'export default function (input) {\n  return input.photo.width ?? input.photo.media_type;\n}',
      entry: 'default',
      arguments: [JSON.stringify({ photo })],
      evaluation,
    });

    expect(answerOf(run)).toBe('image/png');
  });
});

describe.each(sourcesUnderTest)('an asset an expression reads inside, on $name instances', ({ source }) => {
  it('is refused where an expression reads a member it lacks or writes it as text, every writing as text one refusal', async () => {
    const instance = await source(unitMemoryBytes);
    const unit = expressionUnitOf(() => instance, settings);
    const given = { data: { photo } };

    const refusals = ['$data.photo.width', ...writingAsText].map((expression) =>
      unit.evaluate(expression, given, evaluation),
    );
    const elsewhere = [
      unit.evaluate('$input.width', { input: photo }, evaluation),
      unit.evaluate('$input.media_type', { input: photo }, evaluation),
      unit.evaluate('$data["a/b"][0]["~"].width', { data: { 'a/b': [{ '~': photo }] } }, evaluation),
    ];
    unit.close();
    const [reading, ...writings] = refusals.map((run) => detailOf(run));

    expect([...refusals, ...elsewhere].map((run) => answerOf(run))).toEqual([
      ...refusals.map(() => 'raised'),
      'raised',
      'image/png',
      'raised',
    ]);
    expect(new Set(writings).size).toBe(1);
    expect(writings[0]).not.toBe(reading);
    expect(elsewhere.map((run) => detailOf(run))).toEqual([reading, '"image/png"', reading]);
  });
});

describe.each(sourcesUnderTest)(
  'what an expression is charged for the values it names, on $name instances',
  ({ source }) => {
    it('is its own code alone, exactly what it was charged before the guard, however large the values it names', async () => {
      const instance = await source(unitMemoryBytes);
      const unit = expressionUnitOf(() => instance, settings);

      const runs = chargedBeforeTheGuard.map(({ expression, data }: Charged) =>
        unit.evaluate(expression, { data }, evaluation),
      );
      unit.close();

      expect(chargedBeforeTheGuard.map(({ data }: Charged) => JSON.stringify(data).length)).toEqual([
        896_174,
        896_174,
        580_013,
        580_013,
        2_320_013,
        mostHeldBytes,
      ]);
      expect(runs.map(({ ran, work }: ProgramRun) => ({ ran, work }))).toEqual(
        chargedBeforeTheGuard.map(({ work }: Charged) => ({ ran: 'answered', work })),
      );
    });

    it('is nothing for the guard over an asset among large values, which is passed on whole', async () => {
      const instance = await source(unitMemoryBytes);
      const unit = expressionUnitOf(() => instance, settings);
      const given = { data: { numbers: numbers(800_000), photo } };

      const runs = ['$data.numbers.length', '$data.photo.media_type', '$data.photo.width'].map((expression) =>
        unit.evaluate(expression, given, evaluation),
      );
      unit.close();

      expect(runs.map((run) => [answerOf(run), run.work])).toEqual([
        [800_000, 0],
        ['image/png', 0],
        ['raised', 0],
      ]);
    });
  },
);

describe.each(sourcesUnderTest)('what the data of a filter is charged, on $name instances', ({ source }) => {
  it('is what it was charged before the guard, and an asset in it is passed on whole', async () => {
    const context = filterContextOf(await source(unitMemoryBytes), settings, evaluation);
    const tests = [context.define('$data.numbers.length > 0'), context.define('$data.photo.width === undefined')];
    context.freeze();
    const value = argumentTextOf({ numbers: numbers(800_000), photo });

    const runs = tests.map((test) => test(value, evaluation));
    context.close();

    expect(runs.map((run) => [answerOf(run), run.work])).toEqual([
      [true, 0],
      ['raised', 0],
    ]);
  });
});
