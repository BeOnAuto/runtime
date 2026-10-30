import { recordedRunIn } from '@on.auto/definitions';
import { Effect } from 'effect';

import type { BuildAddress } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';

const watchEveryMs = 1000;

export function untilTheRunEnds(ports: Pick<PredictionPorts, 'ledger'>, address: BuildAddress): Effect.Effect<void> {
  return Effect.flatMap(Effect.sleep(watchEveryMs), () =>
    Effect.flatMap(recordedRunIn(ports.ledger, address), (run) =>
      run !== undefined && run.run.status === 'started' ? untilTheRunEnds(ports, address) : Effect.void,
    ),
  );
}
