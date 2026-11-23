import type { AppRuntime } from '@on.auto/api';
import { connectionWake, playbooksWaitingIn, replyAwaited } from '@on.auto/interaction';
import { streamAppends } from '@on.auto/ledger';
import type { DispatcherServices } from '@on.auto/operations';
import type { HostWakeUp, WakeSignal } from '@on.auto/workflow-host';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import type { Settings } from '../settings/settings.ts';
import { connectionIntakeServedBy, type IntakeServing } from '../workflows/connection-intake.ts';
import { socketWakeUpOf, type SocketParts } from './served-sockets.ts';
import type { SocketReplies } from './socket-replies.ts';

export interface SocketsServing
  extends
    Pick<SocketParts, 'secrets' | 'opens' | 'identities'>,
    Pick<SocketReplies, 'delivered' | 'tools'>,
    Omit<IntakeServing, 'providers'> {
  readonly chat?: SocketParts['chat'];
}

export function socketsOfTheServer(
  runtime: AppRuntime<DispatcherServices>,
  { providers }: Pick<Settings, 'providers'>,
  { store, secrets, opens, identities, delivered, tools, filters, now, chat }: SocketsServing,
): (signal: WakeSignal) => HostWakeUp {
  const ledger = runtimeLedger(runtime);
  return socketWakeUpOf({
    streams: store.database.store,
    registries: { registry: ledger, providers },
    secrets,
    opens,
    wake: connectionWake({ ledger }),
    replies: { waitingIn: playbooksWaitingIn({ ledger }), awaited: replyAwaited({ ledger }), delivered, tools },
    takeIn: connectionIntakeServedBy(runtime, { store, filters, providers, now }),
    identities,
    appended: streamAppends,
    context: runtime.context,
    ...(chat === undefined ? {} : { chat }),
  });
}
