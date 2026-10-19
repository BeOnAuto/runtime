import { parsedTemplate, templateEngine } from '@on.auto/definitions/template';
import { standingRenderClock } from '@on.auto/definitions/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/document-problems.ts';
import { weeklyOrdersWith } from '../testing/weekly-orders.ts';
import { briefRenderIssues, renderedBrief } from './brief-template.ts';

const firstLine =
  'Fit a model of the weekly {{ function.target }} of each of {{ dataset.series }} regions, in {{ function.unit }},';

const variables = { dataset: { rows: 3 }, function: { name: 'weekly-orders' } };

describe('the brief rendered for a trainer', () => {
  it('renders over the facts of a dataset and its function', () => {
    const parsed = Result.getOrThrow(
      parsedTemplate(templateEngine(), 'Fit {{ function.name }} over {{ dataset.rows }} rows', 1),
    );

    expect(renderedBrief(parsed, variables, standingRenderClock)).toEqual(
      Result.succeed('Fit weekly-orders over 3 rows'),
    );
  });

  it('is refused with the engine’s own words when the engine fails to render it', () => {
    const refusing = templateEngine(() => ({
      filters: {
        refuse: () => {
          throw new Error('the filter refused its value');
        },
      },
    }));
    const parsed = Result.getOrThrow(parsedTemplate(refusing, 'Fit\n{{ dataset.rows | refuse }}', 28));

    expect(briefRenderIssues(parsed, variables, standingRenderClock, refusing)).toEqual([
      { line: 29, pointer: '', detail: 'The brief does not render: the filter refused its value' },
    ]);
  });

  it('is refused for more names than a template may use, and for a part read below one the dataset does not have', () => {
    const many = Array.from({ length: 1001 }, () => '{{ dataset.rows }}').join('');

    expect(problemsOf(weeklyOrdersWith([firstLine, many]))).toEqual([
      'Line 28: A template may use at most 1000 names in its tags and outputs (variables, properties, filters and keywords); this one uses 2035',
    ]);
    expect(
      problemsOf(weeklyOrdersWith([firstLine, '{{ dataset.features.title }} {{ dataset.features[0].title }}'])),
    ).toEqual([
      'Line 28: dataset.features.title is not a part of dataset; the brief reads dataset (rows, series, periods, window, holdout, features, horizons, accumulates) and function (name, target, unit, rules)',
      'Line 28: dataset.features[0].title is not a part of dataset; the brief reads dataset (rows, series, periods, window, holdout, features, horizons, accumulates) and function (name, target, unit, rules)',
    ]);
    expect(problemsOf(weeklyOrdersWith([firstLine, '{{ dataset.nothing.more }}']))).toEqual([
      'Line 28: dataset.nothing is not a part of dataset; the brief reads dataset (rows, series, periods, window, holdout, features, horizons, accumulates) and function (name, target, unit, rules)',
    ]);
  });
});
