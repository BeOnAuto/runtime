import { describe, expect, it } from 'vitest';

import { publishedOutputOf } from '../index.ts';
import { shapeNamed } from '../testing/index.ts';
import { shapeNameIn } from './published-output.ts';

const calls = { calls: [{ type: 'reasoning', name: 'summarize' }] };

describe('the output a definition publishes', () => {
  it('is the schema of the shape it names, with the shape in its details beside the details of its own', () => {
    const series = shapeNamed('series');

    expect([
      publishedOutputOf({ shape: series }),
      publishedOutputOf({ schema: { type: 'object' }, shape: series, details: calls }),
    ]).toEqual([
      { outputSchema: series.schema, details: { shape: 'series' } },
      { outputSchema: series.schema, details: { ...calls, shape: 'series' } },
    ]);
  });

  it('is its own schema without a shape, and leaves out the schema and the details it does not have', () => {
    expect([
      publishedOutputOf({ schema: { type: 'string' } }),
      publishedOutputOf({ details: calls }),
      publishedOutputOf({ schema: undefined, shape: undefined, details: {} }),
    ]).toEqual([{ outputSchema: { type: 'string' } }, { details: calls }, {}]);
  });
});

describe('the shape named in the details of a definition', () => {
  it('is the shape its details name, and none for details that name no shape, another name or none', () => {
    expect([
      shapeNameIn({ shape: 'series', calls: [] }),
      shapeNameIn({ shape: 'chart' }),
      shapeNameIn({ shape: 3 }),
      shapeNameIn({}),
      shapeNameIn(),
    ]).toEqual(['series', undefined, undefined, undefined, undefined]);
  });
});
