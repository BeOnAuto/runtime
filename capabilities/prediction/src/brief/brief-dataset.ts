import type { DocumentIssue } from '@on.auto/definitions/document';
import { renderClock } from '@on.auto/definitions/template';
import { Effect, type Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import {
  isProjected,
  type DataPart,
  type Evaluation,
  type PredictionFunctionDefinitionDocument,
  type Predicts,
} from '../document/prediction-document.ts';
import { civilDay } from '../periods/civil-days.ts';
import { periodForm, periodOfDay } from '../periods/grains.ts';
import { briefRenderIssues, type BriefVariables } from './brief-template.ts';

interface BriefParts {
  readonly predicts: Predicts;
  readonly data: DataPart;
  readonly evaluation: Evaluation;
  readonly rules: readonly string[];
}

export interface DatasetFigures {
  readonly name: string;
  readonly rows: number;
  readonly series: number;
  readonly firstPeriod: string;
  readonly lastPeriod: string;
}

const longestName = `p${'x'.repeat(47)}`;

const latestDay = civilDay({ year: 9999, month: 12, day: 31 });

function featuresOf(data: DataPart): Schema.JsonArray {
  return isProjected(data)
    ? data.features.map(({ name, as }) => ({ name, as, given: data.given.includes(name) }))
    : data.features.map((name) => ({ name, as: null, given: data.given.includes(name) }));
}

export function briefVariablesOf(
  { predicts, data, evaluation, rules }: BriefParts,
  { name, rows, series, firstPeriod, lastPeriod }: DatasetFigures,
): BriefVariables {
  const { period: grain, season, target, unit, horizons, accumulates } = predicts;
  return {
    dataset: {
      rows,
      series,
      periods: {
        grain,
        season: season ?? null,
        first: firstPeriod,
        last: lastPeriod,
      },
      window: data.window,
      holdout: evaluation.holdout,
      features: featuresOf(data),
      horizons: [...horizons],
      accumulates: accumulates ?? null,
    },
    function: { name, target, unit, rules: [...rules] },
  };
}

function largestBriefVariables(parts: BriefParts): BriefVariables {
  const { period } = parts.predicts;
  const last = periodOfDay(period, latestDay);
  return briefVariablesOf(parts, {
    name: longestName,
    rows: predictionBounds.mostDatasetRows,
    series: predictionBounds.mostDatasetSeries,
    firstPeriod: periodForm(period, last - parts.data.window + 1),
    lastPeriod: periodForm(period, last),
  });
}

export function briefIssuesOverTheLargestDataset(
  document: PredictionFunctionDefinitionDocument,
): Effect.Effect<readonly DocumentIssue[]> {
  return Effect.map(renderClock, (clock) => briefRenderIssues(document.brief, largestBriefVariables(document), clock));
}
