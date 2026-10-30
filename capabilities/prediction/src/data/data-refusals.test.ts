import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/document-problems.ts';
import { weeklyOrdersWith } from '../testing/weekly-orders.ts';

type Replacement = readonly [string, string];

type Refusal = readonly [string, readonly Replacement[], readonly string[]];

const keysTaken = 'it takes events, time, series, target, window';

const columns: readonly Refusal[] = [
  [
    'features, which the forecaster does not read',
    [['  target: { as: count }', '  target: { as: count }\n  features:\n    - { name: basket, of: /total, as: mean }']],
    [`Line 16, /data/features: features is not a key of data; ${keysTaken}`],
  ],
  [
    'given features, which a question does not take',
    [['  target: { as: count }', '  target: { as: count }\n  given: [promotion]']],
    [`Line 15, /data/given: given is not a key of data; ${keysTaken}`],
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
    ],
    [
      'Line 13, /data/series: None of the events the filters name holds a value at /region: a run_succeeded event holds the run’s output under /output',
    ],
  ],
  [
    'a target where neither a run_started nor a run_rejected event holds a value',
    [
      ['    - type: order.placed', '    - type: run_started\n    - type: run_rejected'],
      ['  time: /placed_at', '  time: /reason'],
      ['  series: /region', '  series: /kind'],
      ['  target: { as: count }', '  target: { of: /total, as: sum }'],
    ],
    [
      'Line 15, /data/target/of: None of the events the filters name holds a value at /total: a run_rejected event holds /reason and /kind',
    ],
  ],
  [
    'a time where a definition event holds no data',
    [
      ['    - type: order.placed', '    - type: definition_created'],
      ['  series: /region', "  series: ''"],
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
    [`Line 10, /data/${key}: ${key} is required`],
  ]),
];

describe('a prediction function document whose data part differs from a valid one by one fault', () => {
  it.each([...columns, ...measures, ...parts])('is refused for %s, naming its line', (_fault, replaced, problems) => {
    expect(problemsOf(weeklyOrdersWith(...replaced))).toEqual(problems);
  });
});
