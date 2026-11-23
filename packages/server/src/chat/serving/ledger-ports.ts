import { socketsHeldIn } from '@on.auto/connections';
import { playbooksWaitingIn, replyAwaited } from '@on.auto/interaction';
import { activePlaybooksOf } from '@on.auto/playbooks';
import type { ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import type { runtimeLedger } from '../../composition/runtime-ledger.ts';
import type { ConnectionsComposing } from './chat-connections.ts';

type LedgerReads = ReturnType<typeof runtimeLedger>;

export function connectionsOverTheLedger(ledger: LedgerReads, providers: ProviderList): ConnectionsComposing {
  return {
    held: (org) => Effect.map(socketsHeldIn({ registry: ledger, providers }, org), ({ holders }) => holders),
    playbooks: (org) => activePlaybooksOf(ledger, { org }),
    providers,
    requests: { awaited: replyAwaited({ ledger }), waitingIn: playbooksWaitingIn({ ledger }) },
  };
}
