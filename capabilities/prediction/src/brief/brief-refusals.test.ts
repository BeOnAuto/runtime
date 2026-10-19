import { nothingSaved, standingClock, steppingClock } from '@on.auto/definitions/testing';
import { Clock, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/document-problems.ts';
import { predictionRuns } from '../testing/prediction-runs.ts';
import { weeklyOrdersLines, weeklyOrdersWith } from '../testing/weekly-orders.ts';

const firstLine =
  'Fit a model of the weekly {{ function.target }} of each of {{ dataset.series }} regions, in {{ function.unit }},';

const shape =
  'the brief reads dataset (rows, series, periods, window, holdout, features, horizons, accumulates) and function (name, target, unit, rules)';

const briefLines = weeklyOrdersLines.slice(weeklyOrdersLines.lastIndexOf('---') + 1);

function withBrief(body: string): string {
  return weeklyOrdersWith(
    ...briefLines.map((line, index): readonly [string, string] => [line, index === 0 ? body : '']),
  );
}

const refused: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['an empty brief', '  ', ['Line 28: The definition has no brief: write it after the front matter']],
  [
    'a variable of another function type',
    'Fit {{ input.region }}',
    ['Line 28: input is not a variable of the brief, which reads dataset and function alone'],
  ],
  [
    'a part dataset does not have',
    'Fit {{ dataset.nothing }}',
    [`Line 28: dataset.nothing is not a part of dataset; ${shape}`],
  ],
  [
    'a part of the periods it does not have',
    '{{ dataset.periods.middle }}',
    [`Line 28: dataset.periods.middle is not a part of dataset; ${shape}`],
  ],
  [
    'a part of a feature it does not have',
    '{{ dataset.features.first.title }}',
    [`Line 28: dataset.features.first.title is not a part of dataset; ${shape}`],
  ],
  [
    'the size of a number',
    '{{ dataset.rows.size }}',
    [`Line 28: dataset.rows.size is not a part of dataset; ${shape}`],
  ],
  [
    'a part of a size',
    '{{ function.rules.size.first }}',
    [`Line 28: function.rules.size.first is not a part of function; ${shape}`],
  ],
  [
    'a tag never closed',
    '{% for rule in function.rules %}{{ rule }}',
    ['Line 28: tag {% for rule in function.rules %} not closed'],
  ],
];

const refusedAtSave: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a brief past 64 KiB over the largest dataset',
    `{% for row in (1..dataset.rows) %}${'0123456789abcdef'.repeat(64)}{% endfor %}`,
    'Line 28: The brief renders to more than 65,536 bytes over the largest dataset the bounds admit; shorten it or loop over less',
  ],
  [
    'a list where text goes',
    'Horizons: {{ dataset.horizons }}',
    'Line 28: The brief writes a list or a mapping where text goes; write its items, or use the json filter',
  ],
  [
    'a feature the dataset does not have',
    'Fit {{ dataset.features[5].name }}',
    'Line 28: The brief reads dataset.features[5], which the largest dataset the bounds admit does not have',
  ],
  [
    'a range larger than a template may hold',
    '{% for i in (1..6000000) %}{% endfor %}',
    'Line 28: The brief takes more memory to render than a template may, over the largest dataset the bounds admit',
  ],
];

const fourHundredSteps = '{% for i in (1..400) %}{% endfor %}';

const takingMoreTime =
  'Line 28: The brief takes more time to render than a template may, over the largest dataset the bounds admit';

function checkedOn(clock: Clock.Clock, source: string) {
  return Effect.flatMap(predictionRuns().capability.prepare(source), (prepared) => prepared.check(nothingSaved)).pipe(
    Effect.provideService(Clock.Clock, clock),
  );
}

function savedProblemsOf(source: string, clock = standingClock): Promise<unknown> {
  return Effect.runPromise(Effect.flip(checkedOn(clock, source)));
}

describe('the brief of a prediction function', () => {
  it.each(refused)('is refused for %s, naming its line', (_fault, body, problems) => {
    expect(problemsOf(withBrief(body))).toEqual(problems);
  });

  it.each(refusedAtSave)(
    'is read without rendering, and refused at save for %s over the largest dataset, naming its line',
    async (_fault, body, problem) => {
      expect(problemsOf(withBrief(body))).toEqual([]);
      expect(await savedProblemsOf(withBrief(body))).toMatchObject({ issues: [{ pointer: '', detail: problem }] });
    },
  );

  it('renders at save over the largest dataset of a function that names no season', async () => {
    const seasonless = weeklyOrdersWith(['  season: 52', ''], [firstLine, 'Its season: {{ dataset.periods.season }}']);

    expect(await Effect.runPromise(checkedOn(steppingClock(1), seasonless))).toEqual({});
  });

  it('reads the parts of dataset and function, their sizes, and the items of their lists', () => {
    const reading = [
      firstLine,
      '{{ dataset.horizons.size }} {{ dataset.horizons.first }} {{ function.rules[0] }} {{ function.name.size }}',
      '{{ dataset.periods.grain }} {{ dataset.periods.season }} {{ dataset.holdout }} {{ dataset.rows }} {{ function.name }}',
      '{{ dataset.features[0].given }} {{ dataset.features.last.as }} {{ dataset.features.size }}',
      '{{ dataset.features | map: "name" | json }}',
    ].join('\n');

    expect(problemsOf(withBrief(reading))).toEqual([]);
  });

  it('is refused with the issues of its front matter when the front matter does not read', () => {
    expect(problemsOf(weeklyOrdersWith(['  window: 156', '  window: many'], [firstLine, '{{ input.x }}']))).toEqual([
      'Line 19, /data/window: Expected number',
      'Line 28: input is not a variable of the brief, which reads dataset and function alone',
    ]);
    expect(problemsOf(weeklyOrdersWith(['  window: 156', '  window: [1'], [firstLine, '{{ input.x }}']))).toEqual([
      'Line 20: Flow sequence in block collection must be sufficiently indented and end with a ]',
      'Line 28: input is not a variable of the brief, which reads dataset and function alone',
    ]);
  });
});

describe('the time a brief takes to render at save', () => {
  it('is counted on the clock of the save, which refuses a loop longer than a template may render, and lets the same loop render on a clock that stands still', async () => {
    const loop = withBrief(fourHundredSteps);

    expect(problemsOf(loop)).toEqual([]);
    expect(await savedProblemsOf(loop, steppingClock(1))).toMatchObject({
      issues: [{ pointer: '', detail: takingMoreTime }],
    });
    expect(await Effect.runPromise(checkedOn(standingClock, loop))).toEqual({});
  });
});
