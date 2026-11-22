import type { SomeFolder } from '@on.auto/workflow-host';
import {
  fewSweeps,
  projectedFolders,
  steppedBy,
  steppedClock,
  type DatabaseSettings,
  type ProjectedFolders,
  type SteppedClock,
} from '@on.auto/workflow-host/testing';
import { onTestFinished } from 'vitest';

export type SteppedUntil = <A>(read: () => Promise<A>, holds: (value: A) => boolean) => Promise<A>;

export interface SteppedProjection {
  readonly folders: ProjectedFolders;
  readonly clock: SteppedClock;
  readonly start: ProjectedFolders['start'];
  readonly steppedUntil: SteppedUntil;
}

const projectorSweepsEveryMs = 50;

/**
 * Folders whose projector runs on a stepped clock, watched for rest: what a test waits for is read each time the
 * projector rests, and the clock is stepped a sweep on, a few sweeps at most, only while it rests without it, so a
 * sweep runs when the test needs one and never on the real clock.
 */
export async function steppedProjectionOf(
  settings: DatabaseSettings,
  folding: readonly SomeFolder[],
  start: number = Date.now(),
): Promise<SteppedProjection> {
  const folders = await projectedFolders(settings, folding);
  onTestFinished(folders.close);
  const clock = steppedClock(start);
  const sweep = { everyMs: projectorSweepsEveryMs };
  const steppedUntil: SteppedUntil = (read, holds) => steppedBy(clock, sweep.everyMs).until(read, holds, fewSweeps);
  return {
    folders,
    clock,
    start: (options = {}) => {
      sweep.everyMs = options.sweepEveryMs ?? projectorSweepsEveryMs;
      folders.start({ ...options, clock, context: clock.watching(options.context) });
    },
    steppedUntil,
  };
}
