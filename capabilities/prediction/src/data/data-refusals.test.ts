import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/document-problems.ts';
import { weeklyOrdersWith } from '../testing/weekly-orders.ts';

type Replacement = readonly [string, string];

type Refusal = readonly [string, readonly Replacement[], readonly string[]];

const basket = '    - { name: basket, of: /total, as: mean }';

const promotion = '    - { name: promotion, of: /promotion, as: last }';

const uploaded: readonly Replacement[] = [
  ['  events:', `  dataset: ${'b'.repeat(64)}`],
  ['    - type: order.placed', ''],
  ['  time: /placed_at', ''],
  ['  series: /region', ''],
  ['  target: { as: count }', ''],
  [basket, '    - basket'],
  [promotion, '    - promotion'],
];

const manyFeatures = Array.from({ length: 41 }, (_, index) => `    - { name: f${index}, of: /f${index}, as: sum }`);

const columns: readonly Refusal[] = [
  [
    'a given name not among the features',
    [['  given: [promotion]', '  given: [discount]']],
    ['Line 18, /data/given/0: discount is not among the features, and given names only features'],
  ],
  [
    'a given name repeated',
    [['  given: [promotion]', '  given: [promotion, promotion]']],
    ['Line 18, /data/given/1: promotion is given more than once'],
  ],
  [
    'a feature named series',
    [[basket, '    - { name: series, of: /total, as: mean }']],
    ['Line 16, /data/features/0/name: series is a column every dataset row already has; name the quantity otherwise'],
  ],
  [
    'a feature named as the target',
    [[basket, '    - { name: orders, of: /total, as: mean }']],
    ['Line 16, /data/features/0: The feature orders is named as the target; the target is its own column'],
  ],
  [
    'a feature named twice',
    [
      [promotion, '    - { name: basket, of: /promotion, as: last }'],
      ['  given: [promotion]', '  given: [basket]'],
    ],
    ['Line 17, /data/features/1: The feature basket is named more than once'],
  ],
  [
    'forty-one features',
    [
      [basket, manyFeatures.join('\n')],
      [promotion, ''],
      ['  given: [promotion]', '  given: [f0]'],
    ],
    ['Line 16, /data/features: A prediction function takes at most 40 features; it names 41'],
  ],
];

const measures: readonly Refusal[] = [
  [
    'count with of',
    [['  target: { as: count }', '  target: { of: /total, as: count }']],
    ['Line 14, /data/target/of: count counts the events and reads no value, so it takes no of'],
  ],
  [
    'sum without of',
    [['  target: { as: count }', '  target: { as: sum }']],
    ['Line 14, /data/target: sum reads a value of each event, so it names where with of, a JSON Pointer into its data'],
  ],
  [
    'a feature counted with of',
    [[basket, '    - { name: basket, of: /total, as: count }']],
    ['Line 16, /data/features/0/of: count counts the events and reads no value, so it takes no of'],
  ],
  [
    'a feature that is not a mapping',
    [[basket, '    - basket']],
    ['Line 16, /data/features/0: A feature is a mapping of its name, of and as'],
  ],
  [
    'a feature of keys it does not take',
    [[basket, '    - { title: basket, of: 5, as: median }']],
    [
      'Line 16, /data/features/0/title: title is not a key of a feature; it takes name, of and as',
      'Line 16, /data/features/0/name: name is required, as text',
      'Line 16, /data/features/0/of: of is text',
      'Line 16, /data/features/0/as: as is required: count, sum, last, mean',
    ],
  ],
  [
    'a series that is not a JSON Pointer',
    [['  series: /region', '  series: region']],
    [
      "Line 13, /data/series: region is not a JSON Pointer into an event's data, such as /order/region; write ~1 for a slash and ~0 for a tilde in a key",
    ],
  ],
  [
    'a series where a run_succeeded event holds no value',
    [
      ['    - type: order.placed', '    - type: run_succeeded'],
      ['  time: /placed_at', '  time: /output/placed_at'],
      [basket, '    - { name: basket, of: /output/total, as: mean }'],
      [promotion, '    - { name: promotion, of: /output/promotion, as: last }'],
    ],
    [
      'Line 13, /data/series: None of the events the filters name holds a value at /region: a run_succeeded event holds the run’s output under /output',
    ],
  ],
  [
    'features where neither a run_started nor a run_rejected event holds a value',
    [
      ['    - type: order.placed', '    - type: run_started\n    - type: run_rejected'],
      ['  time: /placed_at', '  time: /reason'],
      ['  series: /region', '  series: /kind'],
    ],
    [
      'Line 17, /data/features/0/of: None of the events the filters name holds a value at /total: a run_rejected event holds /reason and /kind',
      'Line 18, /data/features/1/of: None of the events the filters name holds a value at /promotion: a run_rejected event holds /reason and /kind',
    ],
  ],
  [
    'a time where a definition event holds no data',
    [
      ['    - type: order.placed', '    - type: definition_created'],
      ['  series: /region', "  series: ''"],
      ['  features:', ''],
      [basket, ''],
      [promotion, ''],
      ['  given: [promotion]', ''],
    ],
    [
      'Line 12, /data/time: None of the events the filters name holds a value at /placed_at: the events the filters name hold no data',
      'Line 13, /data/series: None of the events the filters name holds a value at the root of its data: the events the filters name hold no data',
    ],
  ],
];

const parts: readonly Refusal[] = [
  [
    'no filter',
    [
      ['  events:', '  events: []'],
      ['    - type: order.placed', ''],
    ],
    ['Line 10, /data/events: A dataset folds the events at least one filter names; it names none'],
  ],
  [
    'nine filters',
    [['    - type: order.placed', Array.from({ length: 9 }, (_, index) => `    - type: order.${index}`).join('\n')]],
    ['Line 11, /data/events: A dataset takes at most 8 filters; it names 9'],
  ],
  [
    'a filter that is not a mapping',
    [['    - type: order.placed', '    - order.placed']],
    [
      'Line 11, /data/events/0: A filter is a mapping of the attributes an event must have: type, and optionally any other attribute of the event and its data',
    ],
  ],
  [
    'a filter with no type',
    [['    - type: order.placed', '    - source: /orders']],
    [
      'Line 11, /data/events/0/type: An event filter matched over the event alone names the type of the events it takes',
    ],
  ],
  ...(['events', 'time', 'series', 'target'] as const).map((key): Refusal => [
    `a projection without ${key}`,
    key === 'events'
      ? [
          ['  events:', ''],
          ['    - type: order.placed', ''],
        ]
      : [[{ time: '  time: /placed_at', series: '  series: /region', target: '  target: { as: count }' }[key], '']],
    [`Line 10, /data: ${key} is required, unless the function names an uploaded dataset`],
  ]),
  [
    'an uploaded dataset beside a projection',
    uploaded.filter(([from]) => from !== '  time: /placed_at'),
    [
      "Line 11, /data/time: time describes a projection of the playbook's history, and a function that names an uploaded dataset has none",
    ],
  ],
  [
    'an uploaded dataset that is not a digest',
    [...uploaded, [`  dataset: ${'b'.repeat(64)}`, '  dataset: B2']],
    ['Line 10, /data/dataset: dataset is the SHA-256 of an uploaded dataset, 64 lowercase hexadecimal digits'],
  ],
  [
    'a feature of an uploaded dataset that is not a name',
    [...uploaded, ['    - basket', '    - { name: basket }']],
    ['Line 12, /data/features/0: A feature of an uploaded dataset is the name of its column, as text'],
  ],
  [
    'an uploaded feature named as a header column',
    [...uploaded, ['    - basket', '    - period']],
    ['Line 12, /data/features/0: period is a column every dataset row already has; name the quantity otherwise'],
  ],
];

describe('a prediction function document whose data part differs from a valid one by one fault', () => {
  it.each([...columns, ...measures, ...parts])('is refused for %s, naming its line', (_fault, replaced, problems) => {
    expect(problemsOf(weeklyOrdersWith(...replaced))).toEqual(problems);
  });
});
