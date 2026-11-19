import type { Reaches } from '@on.auto/outbound';
import { opensAsDeclared, type OpensASocket } from '@on.auto/providers';
import { bearerRequestOnce, defaultTiming } from '@on.auto/tool-servers';

import { outboundFetch } from '../composition/outbound-fetch.ts';
import { socketOverTheNetwork } from './socket-client.ts';

interface OpeningOver {
  readonly reaches: Reaches;
  readonly mostRequestBytes: number;
}

export function socketsOpenedOver({ reaches, mostRequestBytes }: OpeningOver): OpensASocket {
  return opensAsDeclared({
    sends: bearerRequestOnce,
    sending: { fetch: outboundFetch, reaches, callMs: defaultTiming.callMs, mostRequestBytes },
    constructs: socketOverTheNetwork,
  });
}
