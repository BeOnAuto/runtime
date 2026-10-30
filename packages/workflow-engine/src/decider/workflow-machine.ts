import { Result } from 'effect';

import { inputTimeOf } from '../machine/input-receipt.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import { newRun } from '../machine/run-state.ts';
import { isoInstantOf } from '../machine/utc-time.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { deciding } from './deciding.ts';
import { decided } from './decision.ts';

export function workflowMachine(options: MachineOptions): RunDecider {
  return {
    initialState: newRun,
    evolve: evolveRun,
    decide: (input, state) => Result.succeed(deciding(options, (withUnit) => decided(withUnit, input, state))),
    context: (input, state) =>
      options.contextOf(
        input.kind === 'started' ? input.attributes : state.attributes,
        isoInstantOf(inputTimeOf(state, input)),
      ),
  };
}
