import { describe, expect, it } from 'vitest';

import type { EntryRule } from '../goal-rules/entry-rule.ts';
import { resolvedAt } from './json-pointer.ts';
import { contributed, controls, endedAt, source } from './observation-examples.ts';
import { observationsOf } from './observations.ts';

const refusedValues: readonly (readonly [Omit<EntryRule, 'goal'>, unknown, string])[] = [
  [{ measures: '/failed' }, { failed: '0' }, '/contributes/0: the measure at /failed is not a finite number'],
  [{ measures: '/failed' }, {}, '/contributes/0: the measure at /failed is not a finite number'],
  [
    { measures: '/failed', final: '/done' },
    { failed: 0, done: 'yes' },
    '/contributes/0: final at /done is not true or false',
  ],
  [
    { measures: '/failed', as_of: '/through' },
    { failed: 0, through: '2026-11-09' },
    '/contributes/0: as_of at /through is not an instant with an offset',
  ],
  [
    { measures: '/failed', as_of: '/through' },
    { failed: 0, through: '2026-13-09T00:00:00Z' },
    '/contributes/0: as_of at /through is not an instant with an offset',
  ],
  [
    { measures: '/failed', as_of: '/through' },
    { failed: 0, through: 7 },
    '/contributes/0: as_of at /through is not an instant with an offset',
  ],
  [
    { measures: '/failed', as_of: '/through' },
    { failed: 0, through: '2026-11-09T09:00:01Z' },
    '/contributes/0: as_of at /through lies after the run ended',
  ],
  [
    { measures: '/failed', as_of: '/through' },
    { failed: 0, through: '2025-10-04T08:59:59Z' },
    '/contributes/0: as_of at /through lies more than 400 days before the run ended',
  ],
  [{ says: '/note' }, { note: ['a'] }, '/contributes/0: says at /note is not text'],
];

describe('a JSON pointer', () => {
  const document = { a: [{ 'b/c': 1, 'd~e': 2 }], '': 3 };

  it('reads the whole document, keys, escaped keys and indexes', () => {
    expect(['', '/a/0/b~1c', '/a/0/d~0e', '/'].map((pointer) => resolvedAt(document, pointer))).toEqual([
      { found: true, value: document },
      { found: true, value: 1 },
      { found: true, value: 2 },
      { found: true, value: 3 },
    ]);
  });

  it.each(['a', '/a/1', '/a/01', '/a/-', '/a/0/b/x', '/missing', '/a/0/toString'])('finds nothing at %j', (pointer) => {
    expect(resolvedAt(document, pointer)).toEqual({ found: false });
  });
});

describe('the observations of a run with no each', () => {
  it('reads the measure, final and as_of from the output', () => {
    const { observations } = observationsOf(
      contributed(
        controls,
        { measures: '/failed', final: '/all_reported', as_of: '/through', says: '/note' },
        { failed: 0, all_reported: true, through: '2026-11-09T08:30:00+01:00', note: 'All controls reported.' },
      ),
    );

    expect(observations).toEqual([
      {
        goal: 'controls-hold',
        source,
        at: endedAt,
        measurement: { value: 0, final: true, as_of: Date.parse('2026-11-09T07:30:00Z') },
        says: 'All controls reported.',
      },
    ]);
  });

  it('takes as_of as the end of the run when absent, final as false when absent, and final true as written', () => {
    const absent = observationsOf(contributed(controls, { measures: '/failed' }, { failed: 2 }));
    const literal = observationsOf(contributed(controls, { measures: '/failed', final: true }, { failed: 2 }));

    expect(absent.observations[0]?.measurement).toEqual({ value: 2, final: false, as_of: endedAt });
    expect(literal.observations[0]?.measurement).toEqual({ value: 2, final: true, as_of: endedAt });
  });

  it('carries the milestone it marks, and a title and link cut to 200 characters', () => {
    const { observations } = observationsOf(
      contributed(
        controls,
        { marks: 'checked', title: '/title', link: '/link', says: '/missing' },
        { title: 't'.repeat(250), link: 'https://example.com/1' },
      ),
    );

    expect(observations).toEqual([
      {
        goal: 'controls-hold',
        source,
        at: endedAt,
        marks: 'checked',
        title: 't'.repeat(200),
        link: 'https://example.com/1',
      },
    ]);
  });
});

describe('the parts of a run that are not checked', () => {
  it('leaves out a title that is not text', () => {
    expect(observationsOf(contributed(controls, { title: '/title' }, { title: 4 })).observations[0]).toEqual({
      goal: 'controls-hold',
      source,
      at: endedAt,
    });
  });
});

describe('a value that cannot be read', () => {
  it.each(refusedValues)('refuses %j over %j', (entry, output, detail) => {
    expect(observationsOf(contributed(controls, entry, output))).toEqual({
      observations: [],
      refused: [{ goal: 'controls-hold', workflow: 'measure', run: 'run-1', detail }],
    });
  });
});

describe('the reach of as_of', () => {
  it('keeps an as_of exactly 400 days before the end and exactly at the end', () => {
    const at400 = observationsOf(
      contributed(controls, { measures: '/v', as_of: '/at' }, { v: 1, at: '2025-10-05T09:00:00Z' }),
    );
    const atEnd = observationsOf(
      contributed(controls, { measures: '/v', as_of: '/at' }, { v: 1, at: '2026-11-09T09:00:00.000Z' }),
    );

    expect([at400.observations.length, atEnd.observations[0]?.measurement?.as_of]).toEqual([1, endedAt]);
  });
});
