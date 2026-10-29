import { Conflict, Unavailable } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { RunMeter, type MeteredRun } from '../index.ts';

export type MeterRefusal = 'credits_exhausted' | 'license_required' | 'license_invalid' | 'meter_unavailable';

export interface RecordingMeter {
  readonly layer: Layer.Layer<RunMeter>;
  readonly admitted: () => readonly MeteredRun[];
  readonly refuseNext: (refusal: MeterRefusal) => void;
}

const refusals = {
  credits_exhausted: new Conflict({ detail: 'The account has no credits left', kind: 'credits_exhausted' }),
  license_required: new Conflict({ detail: 'This runtime needs a license', kind: 'license_required' }),
  license_invalid: new Conflict({ detail: 'The key of this runtime was replaced', kind: 'license_invalid' }),
  meter_unavailable: new Unavailable({ detail: 'The account could not be asked', kind: 'meter_unavailable' }),
} as const;

export function recordingMeter(): RecordingMeter {
  const admitted: MeteredRun[] = [];
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
      }),
    ),
    admitted: () => admitted,
    refuseNext: (refusal) => {
      refusing.push(refusal);
    },
  };
}

export const admittingMeter: Layer.Layer<RunMeter> = Layer.succeed(RunMeter, RunMeter.of({ admit: () => Effect.void }));
