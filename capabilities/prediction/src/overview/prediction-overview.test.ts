import { readFileSync } from 'node:fs';

import { markdownOf } from '@on.auto/definitions';
import { sectionIn } from '@on.auto/definitions/testing';
import { describe, expect, it } from 'vitest';

import { dailyTotalsWith, dailyVisitsWith, uploadedDailyVisits } from '../testing/daily-documents.ts';
import { predictionRuns } from '../testing/prediction-runs.ts';
import { weeklyOrdersLines } from '../testing/weekly-orders.ts';

const page = readFileSync(new URL('../../../../docs/reference/prediction-format.md', import.meta.url), 'utf8');

const [example = '', , dataPart = ''] = [...page.matchAll(/```(?:markdown|text|yaml)\n([\s\S]*?)```/gu)].map(
  ([, body = '']: readonly string[]) => body,
);

const sha256 = '3f2ac1d0e4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d';

function goldenOf(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

function overviewOf(source: string): string {
  return markdownOf(predictionRuns().prepared(source).overview('weekly-orders'));
}

function withDataPart(data: string): string {
  const from = weeklyOrdersLines.indexOf('data:');
  const to = weeklyOrdersLines.indexOf('evaluation:');
  return [...weeklyOrdersLines.slice(0, from), data.trimEnd(), ...weeklyOrdersLines.slice(to)].join('\n');
}

describe('the overview of the examples of the reference of prediction functions', () => {
  it('is, byte for byte, the overview pinned beside this test, for the example and over its uploaded dataset', () => {
    expect(overviewOf(example)).toBe(goldenOf('reference-example.overview.md'));
    expect(overviewOf(withDataPart(dataPart))).toBe(goldenOf('reference-uploaded.overview.md'));
  });
});

describe('the overview of a prediction function of a total to the end of a period', () => {
  const overview = overviewOf(
    dailyTotalsWith(
      [
        '  target: { of: /amount, as: sum }',
        '  target: { of: /amount, as: sum }\n  features:\n    - { name: promo, of: /promo, as: last }\n  given: [promo]',
      ],
      ['  activate: automatic', '  shadow_periods: 2\n  activate: automatic'],
    ),
  );

  it('says the total it predicts, its season, and the given value a question names for the periods it sums', () => {
    expect(sectionIn(overview, 'What it predicts')).toBe(
      [
        'It predicts the total of **sales**, counted in sales, for each series from the day after the last one closed to the end of the week that day falls in.',
        'A season is 7 days long.',
        'A question names a series, with the value of **promo** planned for the days it sums.',
        'It answers the last 14 observed days and the total from the next day to the end of its week, with a likely value, a low and a high.',
        'The likely value is the 50th percentile of its model, the low the 10th and the high the 90th.',
      ].join('\n\n'),
    );
  });

  it('dates each event by its own time, sums its target, and runs a new version in a shadow of whole periods summed', () => {
    expect(sectionIn(overview, 'What it learns from')).toContain(
      '- the day, from the time of each event\n- the series, from `/store`\n- **sales**, the sum of `/amount`\n- **promo**, the last value of `/promo`, which a question gives for the days it sums',
    );
    expect(sectionIn(overview, 'How a version goes live')).toContain(
      'A version after the first runs beside the active one for 2 weeks, and takes its place only when it predicts no worse.',
    );
  });
});

const sentThrough = dailyVisitsWith(
  ['  horizons: [1, 2]', '  horizons: [1]\n  history: 1'],
  [
    '    - type: visit.made',
    "    - { type: visit.made, source: shop, data: '${ $data.paid }' }\n    - { type: visit.counted, data: { kind: walk-in } }",
  ],
  [
    '  activate: automatic',
    '  metric: quantile\n  baselines: [persistence]\n  coverage_floor: 0.75\n  confidence: 0.95\n  shadow_periods: 1\n  activate: { approved: approve-version }',
  ],
  ['  expires: P1D', '  expires: PT12H\n  through: send-build'],
  [
    'Fit a model of the daily {{ function.target }} of each of {{ dataset.series }} stores.',
    '{% comment %}Kept for the authors of the function.{% endcomment %}',
  ],
);

describe('the overview of a prediction function sent to its trainer and approved through interaction functions', () => {
  const overview = overviewOf(sentThrough);

  it('predicts one period ahead, answers the history it names, and names the attributes and the data test of each filter', () => {
    expect(sectionIn(overview, 'What it predicts').split('\n\n').slice(0, 3)).toEqual([
      'It predicts **visits**, counted in visits, for each series a day at a time, 1 day ahead.',
      'A question names a series, and one horizon when it asks for that one alone.',
      'It answers the last observed day and 1 day ahead, with a likely value, a low and a high.',
    ]);
    expect(sectionIn(overview, 'What it learns from')).toContain(
      [
        '- each time an event `visit.made` is published to the playbook, from the source `shop` and when `$data.paid` holds for its data',
        '- each time an event `visit.counted` is published to the playbook, when its data is exactly `{"kind":"walk-in"}`',
      ].join('\n'),
    );
  });

  it('names the function a build goes through, its wait, and that its brief holds no text a trainer reads', () => {
    expect(sectionIn(overview, 'Who trains it')).toBe(
      [
        'Each build asks for candidate models through the interaction function **send-build**.',
        'A build waits at most 12 hours for its candidates, and the playbook then scores up to 8 of them, each within 10 minutes.',
        'Its brief holds no text a trainer reads, so its trainer reads the rows and the rules alone.',
      ].join('\n\n'),
    );
  });

  it('says how candidates are scored and that a version goes live once it is approved, and states no rules', () => {
    expect(sectionIn(overview, 'How a version goes live')).toBe(
      [
        'The playbook holds back the last 8 days of the window from the trainer, and scores each candidate on them by the quantile loss of its percentiles.',
        'A candidate passes when its interval holds at least 75% of the truths and it beats **persistence** (the last value carried forward) with 95% confidence; the best that passes becomes the next version.',
        'A version after the first runs beside the active one for 1 day, and takes its place only when it predicts no worse.',
        'A version that passes becomes the active one once it is approved through the interaction function **approve-version**.\n',
      ].join('\n\n'),
    );
    expect(overview).not.toContain('## Rules');
  });
});

describe('the overview of a prediction function over an uploaded dataset of its target alone', () => {
  it('names the dataset and its target, and runs no shadow, since the dataset gains no rows', () => {
    const overview = overviewOf(
      uploadedDailyVisits(sha256).replace(
        '  activate: automatic',
        '  shadow_periods: 3\n  metric: winkler\n  activate: automatic',
      ),
    );

    expect(sectionIn(overview, 'What it learns from')).toBe(
      [
        `It learns from the dataset uploaded to the playbook as \`${sha256}\`, one row a series and a day, with **visits** alone.`,
        'A build reads the last 24 days.',
      ].join('\n\n'),
    );
    expect(sectionIn(overview, 'How a version goes live')).not.toContain('beside the active one');
    expect(sectionIn(overview, 'How a version goes live')).toContain('by the Winkler score of its interval.');
  });
});
