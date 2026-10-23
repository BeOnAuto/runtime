import { compileJsonSchema, jsonSchemaLimits, nestedDeeperThan, utf8Bytes } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  declaredShape,
  outputShapeNamed,
  outputShapeNames,
  outputShapeOf,
  shapeMismatchOf,
  type OutputShapeName,
} from '../index.ts';
import { shapeNamed } from '../testing/index.ts';
import { outputShapeOfSchema } from './output-shapes.ts';

const examples: Readonly<Record<OutputShapeName, Schema.Json>> = {
  series: {
    unit: 'visits',
    period: 'month',
    origin: '2026-08',
    lines: [
      {
        name: 'Observed',
        points: [
          { at: '2026-07', value: 10 },
          { at: '2026-08', value: 12 },
        ],
      },
      { name: 'Expected', points: [{ at: '2026-09', value: 14, low: 11, high: 17 }] },
    ],
    marks: [{ label: 'Goal', value: 15 }],
  },
  categories: {
    unit: 'hours',
    values: [
      { name: 'North', value: 4, low: 3, high: 5 },
      { name: 'South', value: 2 },
    ],
  },
  table: {
    columns: [{ name: 'Item' }, { name: 'Count', unit: 'pieces' }, { name: 'Open' }],
    rows: [
      ['First', 3, true],
      ['Second', null, false],
    ],
  },
  text: { text: '# A heading\n\nA paragraph.' },
};

function isRecord(value: Schema.Json): value is Schema.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectSchemasIn(schema: Schema.Json): readonly Schema.JsonObject[] {
  const children = typeof schema === 'object' && schema !== null ? Object.values(schema) : [];
  const own = isRecord(schema) && schema['type'] === 'object' ? [schema] : [];
  return [...own, ...children.flatMap((child) => objectSchemasIn(child))];
}

describe('the output shapes', () => {
  it('are series, categories, table and text, each answered by its name and by nothing else', () => {
    expect(outputShapeNames()).toEqual(['series', 'categories', 'table', 'text']);
    expect(outputShapeNames().map((name) => outputShapeNamed(name)?.name)).toEqual(outputShapeNames());
    expect([outputShapeNamed('chart'), outputShapeNamed('Series')]).toEqual([undefined, undefined]);
    expect(outputShapeNames().map((name) => outputShapeOf(name))).toEqual(
      outputShapeNames().map((name) => outputShapeNamed(name)),
    );
    expect(() => shapeNamed('chart')).toThrow('There is no shape chart');
  });

  it('are each a JSON Schema of draft 2020-12 the runtime owns, named by its $id and titled with its name', () => {
    expect(
      outputShapeNames().map((name) => {
        const { schema } = shapeNamed(name);
        return [schema['$schema'], schema['$id'], schema['title'], schema['type']];
      }),
    ).toEqual(
      outputShapeNames().map((name) => [
        'https://json-schema.org/draft/2020-12/schema',
        `https://on.auto/shapes/${name}`,
        name,
        'object',
      ]),
    );
  });

  it('close every record they describe', () => {
    const records = outputShapeNames().map((name) => objectSchemasIn(shapeNamed(name).schema));

    expect(records.map((each) => each.length)).toEqual([4, 2, 2, 1]);
    expect(records.flat().map((record) => record['additionalProperties'])).toEqual(records.flat().map(() => false));
  });

  it('each compile within the bounds of every schema, in bytes and in nesting', () => {
    const schemas = outputShapeNames().map((name) => shapeNamed(name).schema);

    expect(
      schemas.map((schema) => Result.isSuccess(compileJsonSchema(schema, { what: 'output', nesting: 512 }))),
    ).toEqual(schemas.map(() => true));
    expect(schemas.every((schema) => utf8Bytes(JSON.stringify(schema)) <= jsonSchemaLimits.bytes)).toBe(true);
    expect(schemas.some((schema) => nestedDeeperThan(schema, jsonSchemaLimits.nesting))).toBe(false);
  });
});

describe('the examples of the output shapes', () => {
  it('each take an example of their own, and check it the same way when asked again', () => {
    const checked = outputShapeNames().flatMap((name) => [
      shapeNamed(name).check(examples[name]),
      shapeNamed(name).check(examples[name]),
    ]);

    expect(checked).toEqual(checked.map(() => []));
  });

  it('each refuse the example of every other shape', () => {
    const refusals = outputShapeNames().flatMap((name) =>
      outputShapeNames()
        .filter((other) => other !== name)
        .map((other) => shapeNamed(name).check(examples[other]).length > 0),
    );

    expect(refusals).toEqual(refusals.map(() => true));
  });
});

describe('the shape of a schema', () => {
  it('is the shape its $id names, and none for a schema without one or with another', () => {
    const shapes = outputShapeNames().map((name) => shapeNamed(name));

    expect(shapes.map(({ schema }) => outputShapeOfSchema(schema))).toEqual(shapes);
    expect(outputShapeOfSchema({ $id: 'https://on.auto/shapes/series', type: 'object' })?.name).toBe('series');
    expect([
      outputShapeOfSchema({ type: 'object' }),
      outputShapeOfSchema({ $id: 'https://example.com/shapes/series' }),
      outputShapeOfSchema('series'),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the words of an output that does not match its shape', () => {
  it('name at most three of its issues, each at its pointer, and nothing of an output that matches', () => {
    const categories = shapeNamed('categories');

    expect(shapeMismatchOf(categories, examples.categories)).toBeUndefined();
    expect(shapeMismatchOf(categories, { values: [] })).toBe('/values: Expected a value with a length of at least 1');
    expect(shapeMismatchOf(categories, 'text')).toBe('the output: Expected object');
  });
});

describe('the shape an output declares', () => {
  it('is the shape it names', () => {
    expect(declaredShape('table', false)).toEqual(Result.succeed(outputShapeNamed('table')));
  });

  it('is refused at its schema beside a schema, since the shape is its schema', () => {
    expect(declaredShape('table', true)).toEqual(
      Result.fail({
        at: 'schema',
        detail: "An output that names a shape takes no schema: the shape's schema is its schema",
      }),
    );
  });

  it('is refused at its name when it names no shape, or is not a name', () => {
    const refusal = Result.fail({
      at: 'shape',
      detail: 'Expected the name of a shape: series, categories, table, or text',
    });

    expect([declaredShape('chart', false), declaredShape(3, false)]).toEqual([refusal, refusal]);
  });
});
