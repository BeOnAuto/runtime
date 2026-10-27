import type { ClockEstimate, ClockRow, ClockSample, ObservedTime } from './records.ts';
import { clockMilliseconds } from './time-samples.ts';

const rollbackTolerance = 5000;

function refreshedAnchor(row: ClockRow, sample: ClockSample, observed: ObservedTime | undefined) {
  const fresh = observed?.id === row.trustId ? observed : undefined;
  return {
    epoch: row.epoch,
    now: fresh?.serverTime ?? row.highWater,
    monotonic: fresh?.monotonic ?? sample.monotonic,
    lastMonotonic: sample.monotonic,
    first: false,
    suspect: false,
  };
}

export function clockEstimator(
  initial: ClockRow,
  monotonic: number,
  observed: () => ObservedTime | undefined,
): (row: ClockRow, sample: ClockSample) => ClockEstimate {
  const anchor = {
    epoch: initial.epoch,
    now: initial.highWater,
    monotonic,
    lastMonotonic: monotonic,
    first: true,
    suspect: false,
  };
  return (row, sample) => {
    if (anchor.epoch !== row.epoch) {
      Object.assign(anchor, refreshedAnchor(row, sample, observed()));
    }
    anchor.suspect ||=
      (anchor.first && row.trustId !== '' && sample.wall <= row.wallSeen) ||
      sample.monotonic < anchor.lastMonotonic ||
      sample.wall + rollbackTolerance < row.wallSeen;
    anchor.first = false;
    anchor.lastMonotonic = sample.monotonic;
    return {
      now: clockMilliseconds(
        Math.max(
          row.highWater,
          row.serverAnchor + sample.wall - row.wallAnchor,
          anchor.now + Math.max(0, sample.monotonic - anchor.monotonic),
        ),
      ),
      wall: sample.wall,
      onlineRequired: row.onlineRequired || anchor.suspect,
    };
  };
}
