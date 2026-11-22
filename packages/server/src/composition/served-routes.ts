import {
  apiCatalogRoutes,
  contentAddressRoutes,
  debugRoutes,
  guideRoutes,
  guideShelfFrom,
  mcpRoutes,
  openApiDocumentRoutes,
  operationRoutes,
  readDebugStyle,
  type AppRuntime,
  type GuidePages,
  type RegisterRoutes,
  type RetryStateKeys,
} from '@on.auto/api';
import { inTheDirectoryListing, type Capability } from '@on.auto/definitions';
import type { ContentAddressKey } from '@on.auto/identity';
import { renderCompanionGuides } from '@on.auto/interaction';
import {
  makeCatalog,
  makeDispatcher,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
} from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';

import { logMcpError } from '../logging/logging.ts';
import { deliveryRoutesOf, type DeliveryStores } from '../webhooks/delivery-routes.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';

type Operations = Parameters<typeof makeCatalog>[0];

export interface ServedCatalog extends DeliveryStores {
  readonly catalog: Catalog;
  readonly directoryCatalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly capabilities: readonly Capability[];
  readonly pages: boolean;
  readonly goals: boolean;
  readonly messages: boolean;
  readonly authorizationServer: string | undefined;
  readonly retryStateKeys: RetryStateKeys;
  readonly contentAddressKey: ContentAddressKey;
  readonly shippedFiles: ShippedFiles;
  readonly guidePages?: GuidePages | undefined;
}

function shelvingOf({
  pages,
  goals,
  messages,
  guidePages,
}: Pick<ServedCatalog, 'pages' | 'goals' | 'messages' | 'guidePages'>) {
  return {
    pages,
    goals,
    messages,
    companions: renderCompanionGuides,
    ...(guidePages === undefined ? {} : { renditions: guidePages }),
  };
}

export async function routesFor(
  runtime: AppRuntime<DispatcherServices>,
  {
    catalog,
    directoryCatalog,
    dispatcher,
    capabilities,
    pages,
    goals,
    messages,
    authorizationServer,
    retryStateKeys,
    contentAddressKey,
    answerStores,
    eventStores,
    shippedFiles,
    guidePages,
  }: ServedCatalog,
): Promise<readonly RegisterRoutes[]> {
  const shelving = shelvingOf({ pages, goals, messages, guidePages });
  const shelf = await guideShelfFrom(shippedFiles, capabilities, shelving);
  const directoryShelf = await guideShelfFrom(shippedFiles, inTheDirectoryListing(capabilities), shelving);
  const directoryListing = { catalog: directoryCatalog, shelf: directoryShelf };
  const debugStyle = await readDebugStyle(shippedFiles);
  return [
    operationRoutes({ catalog, dispatcher, runCall: runtime.run }),
    openApiDocumentRoutes({ catalog, serverInfo: release, shelf, authorizationServer }),
    contentAddressRoutes({ key: contentAddressKey, content: runtimeLedger(runtime).content }),
    ...deliveryRoutesOf(runtime, { answerStores, eventStores }),
    guideRoutes(shelf),
    debugRoutes({ catalog, shelf, serverInfo: release, directoryListing }, debugStyle, guidePages),
    apiCatalogRoutes(shelf),
    mcpRoutes({
      catalog,
      dispatcher,
      runCall: runtime.run,
      serverInfo: release,
      shelf,
      directoryListing,
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
    authorizationServer,
    retryStateKeys,
    contentAddressKey,
    shippedFiles,
  }: Pick<ServedCatalog, 'authorizationServer' | 'retryStateKeys' | 'contentAddressKey' | 'shippedFiles'>,
): (runtime: AppRuntime<DispatcherServices>) => Promise<readonly RegisterRoutes[]> {
  const catalog = makeCatalog(operations);
  const served = {
    catalog,
    directoryCatalog: catalog,
    dispatcher: makeDispatcher([]),
    capabilities: [],
    pages: false,
    goals: false,
    messages: false,
    authorizationServer,
    retryStateKeys,
    contentAddressKey,
    shippedFiles,
  };
  return (runtime) => routesFor(runtime, served);
}
