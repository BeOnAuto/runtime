import { factReaderOf, type RunContext, type RunIds } from '@on.auto/operations';

import { anotherRequest } from './run-claims.ts';
import { RunStartedSchema } from './run-events.ts';

const readStart = factReaderOf(RunStartedSchema);

export function runStartedOf(recorded: unknown): RunContext | undefined {
  return readStart(recorded)?.context;
}

export const runIds: RunIds = {
  types: ['run_started', 'run_cancel_requested'],
  heldElsewhere: () => anotherRequest,
};
