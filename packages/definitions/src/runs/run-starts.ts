import { factReaderOf, type RunContext } from '@on.auto/operations';

import { RunStartedSchema } from './run-events.ts';

const readStart = factReaderOf(RunStartedSchema);

export function runStartedOf(recorded: unknown): RunContext | undefined {
  return readStart(recorded)?.context;
}
