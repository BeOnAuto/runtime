import { describe, expect, it } from 'vitest';

import { contributed, controls, detailsOf, experiments } from './observation-examples.ts';
import type { Contribution } from './observation.ts';
import { mostItems, observationsOf, outputGoneRefusal } from './observations.ts';

describe('the condition of an entry', () => {
  it('observes nothing, silently, when it is false or null', () => {
    expect(observationsOf(contributed(controls, { when: 'x', measures: '/v' }, { v: 1 }, [false]))).toEqual({
      observations: [],
      refused: [],
    });
    expect(observationsOf(contributed(controls, { when: 'x', measures: '/v' }, { v: 1 }, [null])).observations).toEqual(
      [],
    );
  });

  it('observes when it is true', () => {
    expect(
      observationsOf(contributed(controls, { when: 'x', measures: '/v' }, { v: 1 }, [true])).observations,
    ).toHaveLength(1);
  });

  it('refuses the whole entry when it was not reached within its budget, and an item it was never given', () => {
    expect(detailsOf(contributed(controls, { when: 'x' }, {}, 'not_reached'))).toEqual([
      '/contributes/0: the condition took too long',
    ]);
    expect(detailsOf(contributed(controls, { when: 'x' }, {}))).toEqual([
      '/contributes/0: the condition took too long',
    ]);
    expect(
      detailsOf(
        contributed(experiments, { when: 'x', each: '/l', per_id: '/id' }, { l: [{ id: 'a' }, { id: 'b' }] }, [true]),
      ),
    ).toEqual(['/contributes/0, item 1: the condition took too long']);
  });

  it('refuses an item whose condition cannot be evaluated, with a detail of at most 256 bytes', () => {
    const [detail] = detailsOf(contributed(controls, { when: 'x' }, {}, [{ failed: `é${'boom '.repeat(80)}` }]));

    expect(detail?.startsWith('/contributes/0: the condition cannot be evaluated: éboom')).toBe(true);
    expect(new TextEncoder().encode(detail).length).toBeLessThanOrEqual(256);
  });

  it('is not asked for when the entry has none', () => {
    expect(observationsOf(contributed(controls, {}, {}, [false])).observations).toHaveLength(1);
  });
});

describe('the observations of a run with each', () => {
  it('makes one observation an item, naming each by its id, a number by its JSON text', () => {
    const { observations } = observationsOf(
      contributed(
        experiments,
        { each: '/results', per_id: '/issue', measures: '/customers', marks: 'measured' },
        {
          results: [
            { issue: 'MAR-41', customers: 1 },
            { issue: 42, customers: 0 },
          ],
        },
      ),
    );

    expect(observations.map(({ per, source: { item }, measurement }) => [per, item, measurement?.value])).toEqual([
      ['MAR-41', 0, 1],
      ['42', 1, 0],
    ]);
  });

  it('observes nothing, silently, when each resolves to nothing, null or an empty list, or an id resolves to nothing', () => {
    const entry = { each: '/results', per_id: '/issue' };

    expect([
      observationsOf(contributed(experiments, entry, {})),
      observationsOf(contributed(experiments, entry, { results: null })),
      observationsOf(contributed(experiments, entry, { results: [] })),
      observationsOf(contributed(experiments, entry, { results: [{}, { issue: null }] })),
      observationsOf(contributed(experiments, { each: '/results' }, { results: [{}] })),
    ]).toEqual(Array.from({ length: 5 }, () => ({ observations: [], refused: [] })));
  });
});

describe('an each that is not taken whole', () => {
  it('refuses an each that is not a list', () => {
    expect(detailsOf(contributed(experiments, { each: '/results', per_id: '/id' }, { results: {} }))).toEqual([
      '/contributes/0: each at /results is not a list',
    ]);
  });

  it.each([[''], ['x'.repeat(201)], [true]])('refuses an id of %j', (id) => {
    expect(detailsOf(contributed(experiments, { each: '/l', per_id: '/id' }, { l: [{ id }] }))).toEqual([
      '/contributes/0, item 0: the id at /id is not text or a number of 1 to 200 characters',
    ]);
  });

  it('takes an id of exactly 200 characters', () => {
    expect(
      observationsOf(contributed(experiments, { per_id: '/id' }, { id: 'x'.repeat(200) })).observations[0]?.per,
    ).toBe('x'.repeat(200));
  });

  it('observes the first 100 items and refuses the rest, naming them', () => {
    const list = Array.from({ length: 250 }, (_, index) => ({ id: `T-${index}` }));
    const { observations, refused } = observationsOf(
      contributed(experiments, { each: '/l', per_id: '/id' }, { l: list }),
    );

    expect([observations.length, observations.at(-1)?.per]).toEqual([mostItems, 'T-99']);
    expect(refused.map(({ detail }) => detail)).toEqual([
      '/contributes/0: each at /l has 250 items; items 100 to 249 were left out',
    ]);
  });
});

describe('the reach of an each', () => {
  it('observes exactly 100 items with no refusal', () => {
    const list = Array.from({ length: 100 }, (_, index) => ({ id: `T-${index}` }));

    expect(observationsOf(contributed(experiments, { each: '/l', per_id: '/id' }, { l: list })).refused).toEqual([]);
  });

  it('refuses a thing named twice, both times, and keeps the others', () => {
    const { observations, refused } = observationsOf(
      contributed(
        experiments,
        { each: '/l', per_id: '/id', measures: '/v' },
        {
          l: [
            { id: 'A', v: 1 },
            { id: 'C', v: 1 },
            { id: 'A', v: 2 },
            { id: 'D', v: 'x' },
          ],
        },
      ),
    );

    expect(observations.map(({ per }) => per)).toEqual(['C']);
    expect(refused.map(({ detail }) => detail)).toEqual([
      '/contributes/0, item 3: the measure at /v is not a finite number',
      '/contributes/0: the thing "A" is named twice in /l',
    ]);
  });
});

describe('a thing an each names twice', () => {
  it('is refused even where one of its items is refused or its condition is false', () => {
    const { observations, refused } = observationsOf(
      contributed(
        experiments,
        { each: '/l', per_id: '/id', measures: '/v', when: 'x' },
        {
          l: [
            { id: 'A', v: 1 },
            { id: 'B', v: 1 },
            { id: 'A', v: 'x' },
            { id: 'B', v: 2 },
            { id: 'C', v: 3 },
          ],
        },
        [true, false, true, true, true],
      ),
    );

    expect(observations.map(({ per, source }) => [per, source.item])).toEqual([['C', 4]]);
    expect(refused.map(({ detail }) => detail)).toEqual([
      '/contributes/0: the thing "A" is named twice in /l',
      '/contributes/0: the thing "B" is named twice in /l',
    ]);
  });
});

describe('the conditions and the size of an each', () => {
  it('reads the conditions of each item in order', () => {
    const { observations } = observationsOf(
      contributed(
        experiments,
        { each: '/l', per_id: '/id', when: 'x' },
        { l: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] },
        [false, true, null],
      ),
    );

    expect(observations.map(({ per }) => per)).toEqual(['B']);
  });

  it('makes 800 observations from eight entries of 100 items each, in one reading', () => {
    const list = Array.from({ length: 100 }, (_, index) => ({ id: `T-${index}`, v: index }));
    const all = Array.from({ length: 8 }, (_, entryIndex) => ({
      ...contributed(experiments, { each: '/l', per_id: '/id', measures: '/v' }, { l: list }),
      entryIndex,
    })).flatMap((contribution: Contribution) => observationsOf(contribution).observations);

    expect(all).toHaveLength(800);
  });
});

describe('an each on a goal judged as a whole', () => {
  it('makes one observation an item, none of them named', () => {
    expect(observationsOf(contributed(controls, { each: '/l' }, { l: [1, 2] })).observations).toHaveLength(2);
  });
});

describe('an output that is gone', () => {
  it('is a refused observation', () => {
    expect(outputGoneRefusal(contributed(controls, {}, null))).toEqual({
      goal: 'controls-hold',
      workflow: 'measure',
      run: 'run-1',
      detail: "/contributes/0: the run's output can no longer be read",
    });
  });
});
