import {
  apiCatalogRoutes,
  contentAddressRoutes,
  guideRoutes,
  guideShelfFrom,
  mcpRoutes,
  openApiDocumentRoutes,
  operationRoutes,
  type AppRuntime,
  type RegisterRoutes,
  type RetryStateKeys,
} from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import type { ContentAddressKey } from '@on.auto/identity';
import {
  makeCatalog,
  makeDispatcher,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
} from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';

import { logMcpError } from '../logging/logging.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';

type Operations = Parameters<typeof makeCatalog>[0];

export interface ServedCatalog {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly capabilities: readonly Capability[];
  readonly identityIssuer: string;
  readonly retryStateKeys: RetryStateKeys;
  readonly contentAddressKey: ContentAddressKey;
  readonly shippedFiles: ShippedFiles;
}

export async function routesFor(
  runtime: AppRuntime<DispatcherServices>,
  { catalog, dispatcher, capabilities, identityIssuer, retryStateKeys, contentAddressKey, shippedFiles }: ServedCatalog,
): Promise<readonly RegisterRoutes[]> {
  const shelf = await guideShelfFrom(shippedFiles, capabilities);
  return [
    operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
    openApiDocumentRoutes({ catalog, serverInfo: release, shelf, identityIssuer }),
    contentAddressRoutes({ key: contentAddressKey, content: runtimeLedger(runtime).content }),
    guideRoutes(shelf),
    apiCatalogRoutes(shelf),
    mcpRoutes({
      catalog,
      dispatcher,
      runCall: runtime.run,
      serverInfo: release,
      shelf,
      retryStateKeys,
      reportError: (error) => {
        void runtime.run(logMcpError(error));
      },
    }),
  ];
}

export function routesServing(
  operations: Operations,
  {
    identityIssuer,
    retryStateKeys,
    contentAddressKey,
    shippedFiles,
  }: Pick<ServedCatalog, 'identityIssuer' | 'retryStateKeys' | 'contentAddressKey' | 'shippedFiles'>,
): (runtime: AppRuntime<DispatcherServices>) => Promise<readonly RegisterRoutes[]> {
  const catalog = makeCatalog(operations);
  const served = {
    catalog,
    dispatcher: makeDispatcher([]),
    capabilities: [],
    identityIssuer,
    retryStateKeys,
    contentAddressKey,
    shippedFiles,
  };
  return (runtime) => routesFor(runtime, served);
}
