import { authenticatorFor, createApiKey, type Authenticator } from '@on.auto/identity';
import { allPermissions, makeCatalog, makeDispatcher, type DispatcherServices } from '@on.auto/operations';
import {
  memoryPlaybookRegistry,
  memoryLedger,
  recordingReporter,
  type ReportedIncident,
} from '@on.auto/operations/testing';
import { Layer, Redacted, Tracer } from 'effect';
import type { MiddlewareHandler } from 'hono';

import type { ApiEnv } from '../api-env.ts';
import {
  apiCatalogRoutes,
  makeAppRuntime,
  guideRoutes,
  mcpRoutes,
  openApiDocumentRoutes,
  operationRoutes,
  type ApiHandler,
  type ApiStudio,
  type AppRuntime,
  type CallContext,
  type McpRoutesOptions,
  type RegisterRoutes,
  type RetryStateKeys,
} from '../index.ts';
import { createTestHandler, type ReportedThrown } from './api-calls.ts';
import { testShelf } from './guides.ts';
import { notebookOperations } from './notebook.ts';

export interface OperationServer {
  readonly handler: ApiHandler;
  readonly runtime: AppRuntime<DispatcherServices>;
  readonly incidents: () => readonly ReportedIncident[];
  readonly thrown: () => readonly ReportedThrown[];
  readonly mcpErrors: () => readonly string[];
}

export const testServerInfo = { name: '@on.auto/runtime', version: '0.0.0-test' };

export const testIdentityIssuer = 'https://identity.example';

export const testRetryStateKeys: RetryStateKeys = { current: Redacted.make(new Uint8Array(32).fill(7)) };

const knownPlaybooks = [
  { org: 'acme', playbook: 'alpha' },
  { org: 'acme', playbook: 'beta' },
  { org: 'globex', playbook: 'gamma' },
];

export const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

export const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

export const acmeAlphaWriter = createApiKey({
  id: 'acme-alpha-writer',
  org: 'acme',
  permissions: allPermissions,
  playbooks: ['alpha'],
});

export const globexAdmin = createApiKey({
  id: 'globex-admin',
  org: 'globex',
  permissions: allPermissions,
  playbooks: '*',
});

const documented = { serverInfo: testServerInfo, shelf: testShelf, identityIssuer: testIdentityIssuer };

const keyHolders = authenticatorFor({
  host: '0.0.0.0',
  apiKeys: [acmeAdmin.entry, acmeReader.entry, acmeAlphaWriter.entry, globexAdmin.entry],
});

export interface OperationServerOptions {
  readonly authenticator?: Authenticator;
  readonly allowedOrigins?: readonly string[];
  readonly studio?: ApiStudio;
  readonly operations?: Parameters<typeof makeCatalog>[0];
  readonly requests?: MiddlewareHandler<ApiEnv>;
  readonly tracer?: Tracer.Tracer;
  readonly retryStateKeys?: RetryStateKeys;
  readonly heartbeatEveryMs?: number;
  readonly callContext?: CallContext;
}

function tracingWith(tracer: Tracer.Tracer | undefined): Layer.Layer<never> {
  return tracer === undefined ? Layer.empty : Layer.succeed(Tracer.Tracer, tracer);
}

type McpServed = Pick<McpRoutesOptions, 'catalog' | 'dispatcher' | 'runCall' | 'retryStateKeys'> & {
  readonly heartbeatEveryMs: number | undefined;
};

function mcpRoutesServing(
  { heartbeatEveryMs, ...served }: McpServed,
  reportError: McpRoutesOptions['reportError'],
): RegisterRoutes {
  return mcpRoutes({
    ...served,
    serverInfo: testServerInfo,
    shelf: testShelf,
    ...(heartbeatEveryMs === undefined ? {} : { heartbeatEveryMs }),
    reportError,
  });
}

export async function operationServer({
  authenticator = keyHolders,
  allowedOrigins = [],
  studio,
  operations = notebookOperations,
  requests,
  tracer,
  retryStateKeys = testRetryStateKeys,
  heartbeatEveryMs,
  callContext,
}: OperationServerOptions = {}): Promise<OperationServer> {
  const ledger = memoryLedger();
  const recording = recordingReporter();
  const runtime = await makeAppRuntime(
    Layer.mergeAll(ledger.layer, memoryPlaybookRegistry(knownPlaybooks), recording.layer, tracingWith(tracer)),
  );
  const catalog = makeCatalog(operations);
  const dispatcher = makeDispatcher([]);
  const mcpErrors: string[] = [];
  const routes = [
    operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
    openApiDocumentRoutes({ catalog, ...documented }),
    guideRoutes(testShelf),
    apiCatalogRoutes(testShelf),
    mcpRoutesServing({ catalog, dispatcher, runCall: runtime.run, retryStateKeys, heartbeatEveryMs }, (error) => {
      mcpErrors.push(error.message);
    }),
  ];
  const { handler, reported } = createTestHandler({
    authenticator,
    allowedOrigins,
    ...(studio === undefined ? {} : { studio }),
    routes,
    ...(requests === undefined ? {} : { requests }),
    ...(callContext === undefined ? {} : { callContext }),
  });
  return {
    handler,
    runtime,
    incidents: recording.reported,
    thrown: () => [...reported],
    mcpErrors: () => [...mcpErrors],
  };
}
