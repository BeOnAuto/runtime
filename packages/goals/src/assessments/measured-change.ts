import type { Instant, WindowRule, WindowSpan } from '../goal-rules/goal-rule.ts';
import type { AssessmentState, FinalMeasurement, StandingMeasurement } from './assessment-state.ts';
import { countsIn } from './window-counting.ts';

export interface Measured {
  readonly value: number;
  readonly final: boolean;
  readonly as_of: Instant;
  readonly at: Instant;
  readonly run: string;
  readonly says?: string;
  readonly opening?: true;
}

export interface MeasuredChange {
  readonly measurement?: StandingMeasurement;
  readonly finalMeasurement?: FinalMeasurement;
  readonly lateMeasurement?: FinalMeasurement;
}

export function openingPart(opening: boolean): { readonly opening?: true } {
  return opening ? { opening: true } : {};
}

function settlesFinally(rule: WindowRule | undefined, window: WindowSpan | undefined, measured: Measured): boolean {
  return measured.final && rule !== undefined && window !== undefined && countsIn(rule, window, measured);
}

function isRepeated(state: AssessmentState, window: WindowSpan | undefined, measured: Measured): boolean {
  const { measurement } = state;
  if (measurement === undefined || measurement.value !== measured.value) {
    return false;
  }
  if (window !== undefined && !measured.final && measured.at > window.closes) {
    return true;
  }
  if (measurement.final !== measured.final) {
    return false;
  }
  const rule = state.pinned?.window;
  return rule === undefined || (window !== undefined && countsIn(rule, window, measurement));
}

function isLater(before: { readonly as_of: Instant } | undefined, measured: Measured): boolean {
  return before === undefined || measured.as_of > before.as_of;
}

function finalPart(measured: Measured): FinalMeasurement {
  const { value, as_of, at, run } = measured;
  return { value, as_of, at, run, ...openingPart(measured.opening === true) };
}

function arrivesLate(state: AssessmentState, window: WindowSpan | undefined, measured: Measured): boolean {
  return (
    measured.final && window !== undefined && measured.as_of > window.closes && isLater(state.lateMeasurement, measured)
  );
}

function numberOfTheMiss(state: AssessmentState, measured: Measured): MeasuredChange {
  const missedWithNoNumber = state.verdict === 'failed' && state.verdictBy === 'deadline';
  return missedWithNoNumber && measured.final && isLater(state.lateMeasurement, measured)
    ? { measurement: measured, lateMeasurement: finalPart(measured) }
    : {};
}

export function measuredChangeOf(
  state: AssessmentState,
  window: WindowSpan | undefined,
  measured: Measured,
): MeasuredChange {
  if (state.verdict !== 'open') {
    return numberOfTheMiss(state, measured);
  }
  if (isRepeated(state, window, measured)) {
    return {};
  }
  const standing = measured.opening === true || isLater(state.measurement, measured);
  const final = settlesFinally(state.pinned?.window, window, measured) && isLater(state.finalMeasurement, measured);
  return {
    ...(standing ? { measurement: measured } : {}),
    ...(final ? { finalMeasurement: finalPart(measured) } : {}),
    ...(arrivesLate(state, window, measured) ? { lateMeasurement: finalPart(measured) } : {}),
  };
}
