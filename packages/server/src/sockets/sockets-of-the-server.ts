import type { AppRuntime } from '@on.auto/api';
import { connectionWake } from '@on.auto/interaction';
import { streamAppends } from '@on.auto/ledger';
import type { DispatcherServices } from '@on.auto/operations';
import type { HostWakeUp, WakeSignal } from '@on.auto/workflow-host';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import type { Settings } from '../settings/settings.ts';
import { socketWakeUpOf, type SocketParts } from './served-sockets.ts';

export interface SocketsServing extends Pick<SocketParts, 'secrets' | 'opens'> {
  readonly store: { readonly database: { readonly store: SocketParts['streams'] } };
}

export function socketsOfTheServer(
  runtime: AppRuntime<DispatcherServices>,
  { providers }: Pick<Settings, 'providers'>,
  { store, secrets, opens }: SocketsServing,
): (signal: WakeSignal) => HostWakeUp {
  const ledger = runtimeLedger(runtime);
  return socketWakeUpOf({
    streams: store.database.store,
    registries: { registry: ledger, providers },
    secrets,
    opens,
    wake: connectionWake({ ledger }),
    appended: streamAppends,
    context: runtime.context,
  });
}
