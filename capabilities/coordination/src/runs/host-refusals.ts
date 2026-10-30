import { Unavailable } from '@on.auto/operations';
import { HostElsewhere } from '@on.auto/workflow-host';

export function unavailableUnless(notNow: string): (failure: Readonly<{ detail: string }>) => Unavailable {
  return (failure) => new Unavailable({ detail: failure instanceof HostElsewhere ? failure.detail : notNow });
}
