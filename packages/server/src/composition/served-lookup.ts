import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import { makeLookupFunctionAdapter, type LookupPorts } from '@on.auto/lookup';
import type { DispatcherServices } from '@on.auto/operations';

import { runtimeLedger } from './runtime-ledger.ts';

export type ServedLookup = Capability;

export function lookupServedBy(runtime: AppRuntime<DispatcherServices>, tools: LookupPorts['tools']): ServedLookup {
  return makeLookupFunctionAdapter({ tools, runs: runtimeLedger(runtime) });
}
