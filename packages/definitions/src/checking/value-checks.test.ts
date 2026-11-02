import { fileURLToPath } from 'node:url';

import { importedWithoutAnAddress, modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { outputShapeNamed, shapedViewsSchemaOf } from '../index.ts';
import * as checkedWorkerModule from './checked-worker.ts';
import { outputCheckOf, valueChecks, viewCheckOf } from './value-checks.ts';
import { checkedWorker } from './worker-url.ts';

const categoriesSchema = outputShapeNamed('categories')?.schema ?? {};

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
      { kind: 'shape', detail: 'The fold returns an object of named views, each of the shape data.views gives it' },
      { kind: 'shape', detail: 'The fold returned by_week, which data.views does not declare' },
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
