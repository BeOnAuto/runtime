import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';

import { figure } from '../capability/figures.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';
import { checkedFrom, isWhole, refusedAt, type Checked } from './checked-parts.ts';
import type { WrittenEvaluation } from './front-matter.ts';
import { functionNameIssues } from './function-names.ts';
import type { Baseline, Evaluation, Predicts } from './prediction-document.ts';
import { longestHorizonOf } from './predicts-part.ts';

const { leastHoldout, mostWindow, leastShare, mostShare, mostShadowPeriods } = predictionBounds;

function leastHoldoutOf(predicts: Predicts): number {
  return Math.max(2 * longestHorizonOf(predicts), leastHoldout);
}

function holdoutIssues(holdout: number, predicts: Predicts, window: number, lines: SourceLines) {
  const at = '/evaluation/holdout';
  const least = leastHoldoutOf(predicts);
  if (!isWhole(holdout, 1, Number.MAX_SAFE_INTEGER)) {
    return refusedAt(lines, at, `The holdout is a whole number of periods, not ${figure(holdout)}`);
  }
  if (holdout < least) {
    return refusedAt(
      lines,
      at,
      `The holdout holds back ${figure(holdout)} periods, fewer than ${figure(least)}: at least twice the longest horizon, ${figure(2 * longestHorizonOf(predicts))}, and at least ${figure(leastHoldout)}`,
    );
  }
  return holdout * 2 > window
    ? refusedAt(
        lines,
        at,
        `The holdout of ${figure(holdout)} periods is more than half the window of ${figure(window)}`,
      )
    : [];
}

function leastWindowOf(holdout: number, predicts: Predicts): { readonly least: number; readonly words: string } {
  const { season } = predicts;
  return season === undefined
    ? {
        least: holdout + 2 * longestHorizonOf(predicts),
        words: `the holdout plus twice the longest horizon, ${figure(holdout)} + 2 × ${figure(longestHorizonOf(predicts))}`,
      }
    : {
        least: holdout + 2 * season,
        words: `the holdout plus two seasons, ${figure(holdout)} + 2 × ${figure(season)}`,
      };
}

function windowIssues(window: number, holdout: number, predicts: Predicts, lines: SourceLines) {
  const at = '/data/window';
  if (!isWhole(window, 1, mostWindow)) {
    return refusedAt(
      lines,
      at,
      `The window is a whole number of periods from 1 to ${figure(mostWindow)}, not ${figure(window)}`,
    );
  }
  const { least, words } = leastWindowOf(holdout, predicts);
  return window < least
    ? refusedAt(lines, at, `The window of ${figure(window)} periods is under ${words} = ${figure(least)}`)
    : [];
}

function baselinesOf(written: WrittenEvaluation, predicts: Predicts): readonly Baseline[] {
  const fallback: readonly Baseline[] =
    predicts.season === undefined ? ['persistence'] : ['persistence', 'seasonal-naive'];
  return written.baselines ?? fallback;
}

function baselineIssues(baselines: readonly Baseline[], predicts: Predicts, lines: SourceLines) {
  if (baselines.length === 0) {
    return refusedAt(lines, '/evaluation/baselines', 'Name at least one baseline a candidate must beat');
  }
  return baselines.flatMap((baseline, index) => {
    const at = `/evaluation/baselines/${index}`;
    if (baseline === 'seasonal-naive' && predicts.season === undefined) {
      return refusedAt(lines, at, 'seasonal-naive takes the value one season earlier, and predicts names no season');
    }
    return baselines.indexOf(baseline) < index ? refusedAt(lines, at, `${baseline} is named more than once`) : [];
  });
}

function shareIssues(share: number, at: string, lines: SourceLines): readonly DocumentIssue[] {
  return share >= leastShare && share <= mostShare
    ? []
    : refusedAt(lines, at, `A share from ${leastShare} to ${mostShare} is expected, not ${share}`);
}

function shadowIssues(periods: number, lines: SourceLines): readonly DocumentIssue[] {
  return isWhole(periods, 0, mostShadowPeriods)
    ? []
    : refusedAt(
        lines,
        '/evaluation/shadow_periods',
        `A shadow lasts a whole number of periods from 0 to ${mostShadowPeriods}, not ${figure(periods)}`,
      );
}

export function evaluationOf(
  written: WrittenEvaluation,
  predicts: Predicts,
  window: number,
  lines: SourceLines,
): Checked<Evaluation> {
  const { holdout, activate } = written;
  const baselines = baselinesOf(written, predicts);
  const coverageFloor = written.coverage_floor ?? predictionBounds.coverageFloor;
  const confidence = written.confidence ?? predictionBounds.confidence;
  const shadowPeriods = written.shadow_periods ?? 0;
  const issues = [
    ...holdoutIssues(holdout, predicts, window, lines),
    ...windowIssues(window, holdout, predicts, lines),
    ...baselineIssues(baselines, predicts, lines),
    ...shareIssues(coverageFloor, '/evaluation/coverage_floor', lines),
    ...shareIssues(confidence, '/evaluation/confidence', lines),
    ...shadowIssues(shadowPeriods, lines),
    ...(activate === 'automatic' ? [] : functionNameIssues(activate.approved, '/evaluation/activate/approved', lines)),
  ];
  return checkedFrom(issues, () => ({
    holdout,
    metric: written.metric ?? 'mase',
    coverageFloor,
    baselines,
    confidence,
    shadowPeriods,
    activate,
  }));
}
