import type { AppRuntime } from '@on.auto/api';
import { registeredClientSecrets } from '@on.auto/connections';
import type { DispatcherServices } from '@on.auto/operations';
import {
  defaultTiming,
  describedToolServers,
  makeToolAccess,
  mostRequestBytesAmong,
  type ConnectionSource,
  type ConsentClient,
  type Describing,
  type Timing,
  type ToolAccess,
  type ToolAccessOptions,
  type ToolServerDocumentRefused,
} from '@on.auto/tool-servers';
import { Context, Effect, Layer } from 'effect';

import { logLeftOutOperation, logMarkUnlisted, logServerMessage } from '../logging/tool-server-logging.ts';
import type { Settings } from '../settings/settings.ts';
import { heldForCalls } from './kept-by-runs.ts';
import { outboundFetch } from './outbound-fetch.ts';
import { release } from './release.ts';

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

interface ServedDocuments {
  readonly documents: NonNullable<ToolAccessOptions['documents']>;
}

type ToolSettings = Pick<Settings, 'toolServers' | 'registeredClients' | 'toolCalls'>;

export class ComposedTools extends Context.Service<ComposedTools, ToolAccess>()('@on.auto/server/ComposedTools') {}

export function toolsComposedBy(
  runtime: AppRuntime<DispatcherServices>,
  { toolServers, registeredClients, toolCalls }: ToolSettings,
  {
    toolTiming,
    now,
    consent,
    connections,
    telemetry,
    documents,
  }: ToolAccessWiring & ServedConnections & ServedDocuments,
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
      documents,
      reportLeftOut,
      ...(toolTiming === undefined ? {} : { timing: toolTiming }),
      ...(now === undefined ? {} : { now }),
      ...(traceMeta === undefined ? {} : { traceMeta }),
      ...heldForCalls(runtime),
      mostRequestBytes: toolCalls.mostRequestBytes,
      runtimeSecrets: registeredClientSecrets(registeredClients),
      reportServerMessage: (report) => {
        void runtime.run(logServerMessage(report));
      },
      reportMarkUnlisted: (server, tool) => {
        void runtime.run(logMarkUnlisted(server, tool));
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
  { toolServers, toolCalls }: Pick<Settings, 'toolServers' | 'toolCalls'>,
  { takesConnections }: Pick<ConnectionSource, 'takesConnections'>,
  { callMs }: Timing = defaultTiming,
): ToolAccess {
  const tools = Effect.orDie(composed);
  return {
    configured: toolServers.servers.length > 0 || takesConnections,
    takesConnections,
    callMs,
    mostRequestBytes: toolCalls.mostRequestBytes,
    mostRequestBytesTo: mostRequestBytesAmong({ servers: toolServers.servers, most: toolCalls.mostRequestBytes }),
    callOnce: (call, runCall) => Effect.flatMap(tools, (access) => access.callOnce(call, runCall)),
    preparedCall: (call) => Effect.flatMap(tools, (access) => access.preparedCall(call)),
    open: (context, references) => Effect.flatMap(tools, (access) => access.open(context, references)),
    named: (address, references) => Effect.flatMap(tools, (access) => access.named(address, references)),
    listServers: (scope, named) => Effect.flatMap(tools, (access) => access.listServers(scope, named)),
    listServersInOrg: (scope, named) => Effect.flatMap(tools, (access) => access.listServersInOrg(scope, named)),
    lookUp: (address, reference) => Effect.flatMap(tools, (access) => access.lookUp(address, reference)),
    listConnection: (org, connection) => Effect.flatMap(tools, (access) => access.listConnection(org, connection)),
    close: () => Promise.resolve(),
  };
}
