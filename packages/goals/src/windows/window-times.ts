import { dueTimesOf, firstDueOf, zoneClockOf, type DueMoments, type ScheduleTiming } from '@on.auto/workflow-host';
import type { Result } from 'effect';

export type WindowTiming = ScheduleTiming;

export type WindowMoments = DueMoments;

export interface WindowEdges {
  readonly latest: number;
  readonly next: number | null;
}

export function windowEdgesAt(timing: WindowTiming, moments: WindowMoments): Result.Result<WindowEdges, string> {
  return dueTimesOf(timing, moments, zoneClockOf);
}

export function windowOpeningAfter(
  timing: WindowTiming,
  anchor: number,
  after = anchor,
): Result.Result<number | null, string> {
  return firstDueOf(timing, anchor, zoneClockOf, after);
}
