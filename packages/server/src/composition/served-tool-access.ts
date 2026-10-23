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
  type ToolServerDocumentRefused,
} from '@on.auto/tool-servers';
import { Context, Effect, Layer } from 'effect';

import { logLeftOutOperation, logServerMessage } from '../logging/tool-server-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { outboundFetch } from './outbound-fetch.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export interface ToolAccessWiring {
  readonly toolTiming?: Timing;
  readonly now?: () => number;
  readonly telemetry?: {
    readonly traceMeta: ToolAccessOptions['traceMeta'];
  };
}

export interface ServedConnections {
  readonly consent: ConsentClient;
  readonly connections: ConnectionSource;
}

type ToolSettings = Pick<Settings, 'toolServers' | 'registeredClients'>;

export class ComposedTools extends Context.Service<ComposedTools, ToolAccess>()('@on.auto/server/ComposedTools') {}

export function toolsComposedBy(
  runtime: AppRuntime<DispatcherServices>,
  { toolServers, registeredClients }: ToolSettings,
  { toolTiming, now, consent, connections, telemetry }: ToolAccessWiring & ServedConnections,
): Layer.Layer<ComposedTools, ToolServerDocumentRefused> {
  const traceMeta = telemetry?.traceMeta;
  const reportLeftOut: Describing['reportLeftOut'] = (server, leftOut) => {
    void runtime.run(logLeftOutOperation(server, leftOut));
  };
  const composing = Effect.map(describedToolServers(toolServers, { fetch: outboundFetch, reportLeftOut }), (servers) =>
    makeToolAccess(servers, {
      clientInfo: release,
      consent,
      fetch: outboundFetch,
      connections,
      reportLeftOut,
      ...(toolTiming === undefined ? {} : { timing: toolTiming }),
      ...(now === undefined ? {} : { now }),
      ...(traceMeta === undefined ? {} : { traceMeta }),
      content: runtimeLedger(runtime).content,
      runtimeSecrets: registeredClientSecrets(registeredClients),
      reportServerMessage: (report) => {
        void runtime.run(logServerMessage(report));
      },
    }),
  );
  return Layer.effect(
    ComposedTools,
    Effect.acquireRelease(composing, (tools) => Effect.promise(() => tools.close())),
  );
}

export function toolAccessOf(
  composed: Effect.Effect<ToolAccess, ToolServerDocumentRefused>,
  { toolServers }: Pick<Settings, 'toolServers'>,
  { takesConnections }: Pick<ConnectionSource, 'takesConnections'>,
): ToolAccess {
  const tools = Effect.orDie(composed);
  return {
    configured: toolServers.servers.length > 0 || takesConnections,
    takesConnections,
    callOnce: (call, runCall) => Effect.flatMap(tools, (access) => access.callOnce(call, runCall)),
    preparedCall: (call) => Effect.flatMap(tools, (access) => access.preparedCall(call)),
    open: (context, references) => Effect.flatMap(tools, (access) => access.open(context, references)),
    named: (address, references) => Effect.flatMap(tools, (access) => access.named(address, references)),
    listServers: (scope, named) => Effect.flatMap(tools, (access) => access.listServers(scope, named)),
    listServersInOrg: (scope, named) => Effect.flatMap(tools, (access) => access.listServersInOrg(scope, named)),
    lookUp: (address, reference) => Effect.flatMap(tools, (access) => access.lookUp(address, reference)),
    close: () => Promise.resolve(),
  };
}
