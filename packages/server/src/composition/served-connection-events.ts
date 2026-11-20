import type { AppRuntime } from '@on.auto/api';
import { connectionEventsOver } from '@on.auto/connections';
import { listenedConnectionsOf } from '@on.auto/definitions/listened-connections';
import type { DispatcherServices } from '@on.auto/operations';
import type { ToolAccess } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export function connectionEventsOf(
  runtime: AppRuntime<DispatcherServices>,
  listServers: ToolAccess['listServers'],
  { providers }: Pick<Settings, 'providers'>,
) {
  const ledger = runtimeLedger(runtime);
  return connectionEventsOver(listServers, Effect.succeed(providers), (playbook) =>
    listenedConnectionsOf(ledger, playbook),
  );
}
