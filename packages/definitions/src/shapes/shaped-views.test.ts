import { describe, expect, it } from 'vitest';

import { outputShapeOf } from './output-shapes.ts';
import { shapedViewsIn, shapedViewsSchemaOf } from './shaped-views.ts';

describe('the schema of the views of a page', () => {
  it('names each view and the shape it takes, and is read back as those shapes', () => {
    const schema = shapedViewsSchemaOf({ by_day: 'series', by_channel: 'categories' });

    expect(schema).toEqual({
      $id: 'https://on.auto/shapes/views',
      type: 'object',
      properties: {
        by_day: { $ref: 'https://on.auto/shapes/series' },
        by_channel: { $ref: 'https://on.auto/shapes/categories' },
      },
      additionalProperties: false,
    });
    expect(shapedViewsIn(schema)).toEqual(
      new Map([
        ['by_day', outputShapeOf('series')],
        ['by_channel', outputShapeOf('categories')],
      ]),
    );
  });

  it('is told apart from any other schema, and passes over a view that names no shape', () => {
    const named = shapedViewsIn({
      $id: 'https://on.auto/shapes/views',
      properties: { by_day: { $ref: 'https://on.auto/shapes/series' }, by_week: { type: 'object' }, by_hour: 'series' },
    });

    expect([shapedViewsIn({ type: 'object' }), shapedViewsIn(null)]).toEqual([undefined, undefined]);
    expect(named).toEqual(new Map([['by_day', outputShapeOf('series')]]));
  });
});
