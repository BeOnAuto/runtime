import type { DispatcherServices } from '@on.auto/operations';

import { storesAndConnectionsOf } from '../connections/served-connections.ts';
import { ledgerDatabaseOf } from '../database/ledger-database.ts';
import { defaultServerOptions, type ServerOptions } from '../lifecycle/lifecycle.ts';
import { serveWorkflows, type WorkflowParts } from '../workflows/workflows.ts';
import { applicationLayer } from './application-layer.ts';
import { functionWiringOf, type FunctionWiring } from './function-wiring.ts';
import { ledgerLayerFor } from './ledger-store.ts';
import { functionsServedBy } from './served-functions.ts';
import { loggedModelAccess } from './served-reasoning.ts';

export function compositionRootWith(
  modelAccessOf: FunctionWiring['modelAccessOf'],
  programPoolOf?: FunctionWiring['programPoolOf'],
  clock?: WorkflowParts['clock'],
  toolTiming?: FunctionWiring['toolTiming'],
): ServerOptions<DispatcherServices> {
  const wiring = functionWiringOf(modelAccessOf, programPoolOf, toolTiming);
  return {
    ...defaultServerOptions,
    composed: (settings, telemetry) => {
      const database = ledgerDatabaseOf(settings, telemetry.appended);
      return {
        services: applicationLayer(ledgerLayerFor(settings, database, wiring.projections.appends)),
        serve: async (runtime, ownOrigin) => {
          const { ledger, workflows, identityIssuer } = settings;
          const { stores, consent, connections, source, offering } = await storesAndConnectionsOf(
            runtime,
            settings,
            database,
            ownOrigin,
          );
          const functions = await functionsServedBy(runtime, settings, database, {
            ...wiring,
            telemetry,
            consent,
            connections: source,
            offering,
          });
          const parts = {
            ledger,
            workflows,
            identityIssuer,
            retryStateKeys: stores.retryStateKeys,
            ...functions.parts,
            orgOperations: [...functions.parts.orgOperations, ...connections],
            ...(clock === undefined ? {} : { clock }),
          };
          return stores.withSecretsClosed(functions.closing(await serveWorkflows(runtime, parts)));
        },
      };
    },
  };
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
