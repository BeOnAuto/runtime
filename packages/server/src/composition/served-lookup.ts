import type { Capability } from '@on.auto/definitions';
import { makeLookupFunctionAdapter, type LookupPorts } from '@on.auto/lookup';

export type ServedLookup = Capability;

export function lookupServedBy(tools: LookupPorts['tools']): ServedLookup {
  return makeLookupFunctionAdapter({ tools });
}
