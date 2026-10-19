import type { AppRuntime } from '@on.auto/api';
import { registeredClientSecrets } from '@on.auto/connections';
import type { DispatcherServices } from '@on.auto/operations';
import {
  describedToolServers,
  makeToolAccess,
  type ConnectionSource,
  type ConsentClient,
  type Describing,
  type Timing,
  type ToolAccess,
  type ToolAccessOptions,
} from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { logLeftOutOperation, logServerMessage } from '../logging/tool-server-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { outboundFetch } from './outbound-fetch.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export interface ToolAccessWiring {
  readonly toolTiming?: Timing;
  readonly telemetry?: {
    readonly traceMeta: ToolAccessOptions['traceMeta'];
  };
}

export interface ServedConnections {
  readonly consent: ConsentClient;
  readonly connections: ConnectionSource;
}

export async function toolAccessOf(
  runtime: AppRuntime<DispatcherServices>,
  { toolServers, registeredClients }: Pick<Settings, 'toolServers' | 'registeredClients'>,
  { toolTiming, consent, connections, telemetry }: ToolAccessWiring & ServedConnections,
): Promise<ToolAccess> {
  const traceMeta = telemetry?.traceMeta;
  const reportLeftOut: Describing['reportLeftOut'] = (server, leftOut) => {
    void runtime.run(logLeftOutOperation(server, leftOut));
  };
  const servers = await Effect.runPromise(describedToolServers(toolServers, { fetch: outboundFetch, reportLeftOut }));
  return makeToolAccess(servers, {
    clientInfo: release,
    consent,
    fetch: outboundFetch,
    connections,
    reportLeftOut,
    ...(toolTiming === undefined ? {} : { timing: toolTiming }),
    ...(traceMeta === undefined ? {} : { traceMeta }),
    content: runtimeLedger(runtime).content,
    runtimeSecrets: registeredClientSecrets(registeredClients),
    reportServerMessage: (report) => {
      void runtime.run(logServerMessage(report));
    },
  });
}
