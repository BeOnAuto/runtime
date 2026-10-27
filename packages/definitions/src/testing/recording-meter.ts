import { Conflict, Unavailable } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { RunMeter, type MeteredEnding, type MeteredRun } from '../index.ts';

export type MeterRefusal = 'credits_exhausted' | 'meter_unavailable';

export interface RecordingMeter {
  readonly layer: Layer.Layer<RunMeter>;
  readonly admitted: () => readonly MeteredRun[];
  readonly settled: () => readonly MeteredEnding[];
  readonly refuseNext: (refusal: MeterRefusal) => void;
}

const refusals = {
  credits_exhausted: new Conflict({ detail: 'The account has no credits left', kind: 'credits_exhausted' }),
  meter_unavailable: new Unavailable({ detail: 'The account could not be asked', kind: 'meter_unavailable' }),
} as const;

export function recordingMeter(): RecordingMeter {
  const admitted: MeteredRun[] = [];
  const settled: MeteredEnding[] = [];
  const refusing: MeterRefusal[] = [];
  return {
    layer: Layer.succeed(
      RunMeter,
      RunMeter.of({
        admit: (run) =>
          Effect.suspend(() => {
            const refusal = refusing.shift();
            if (refusal !== undefined) {
              return Effect.fail(refusals[refusal]);
            }
            admitted.push(run);
            return Effect.void;
          }),
        settle: (ending) =>
          Effect.sync(() => {
            settled.push(ending);
          }),
      }),
    ),
    admitted: () => admitted,
    settled: () => settled,
    refuseNext: (refusal) => {
      refusing.push(refusal);
    },
  };
}
