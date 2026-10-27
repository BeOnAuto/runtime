import type { ClockEstimate, ClockRow, ClockSample } from './records.ts';
import { clockMilliseconds } from './time-samples.ts';

const rollbackTolerance = 5000;

export function clockEstimator(
  initial: ClockRow,
  monotonic: number,
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
      Object.assign(anchor, {
        epoch: row.epoch,
        now: row.highWater,
        monotonic: sample.monotonic,
        lastMonotonic: sample.monotonic,
        first: false,
        suspect: false,
      });
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
