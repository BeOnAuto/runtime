import { capabilityRegistryOpenedIn } from '../capability-registry/capability-registry.ts';
import { storesAndConnectionsOf } from '../connections/served-connections.ts';
import { ledgerDatabaseOf, withARefusedLayoutExplained } from '../database/ledger-database.ts';
import { serverOptionsComposing, type ComposedServerOptions } from '../server-options/composed-options.ts';
import { serveWorkflows, type WorkflowParts } from '../workflows/workflows.ts';
import { applicationLayer } from './application-layer.ts';
import { functionWiringOf, type FunctionWiring } from './function-wiring.ts';
import { ledgerLayerFor } from './ledger-store.ts';
import { functionsServedBy } from './served-functions.ts';
import { loggedModelAccess, modelsComposedBy, type ModelAccessOf } from './served-reasoning.ts';

export function compositionRootWith(
  modelAccessOf: ModelAccessOf,
  programPoolOf?: FunctionWiring['programPoolOf'],
  clock?: WorkflowParts['clock'],
  toolTiming?: FunctionWiring['toolTiming'],
): ComposedServerOptions {
  const wiring = functionWiringOf(programPoolOf, toolTiming);
  return serverOptionsComposing(async (settings, telemetry, shippedFiles) => {
    const database = await ledgerDatabaseOf(settings, telemetry.appended);
    return {
      services: applicationLayer(
        withARefusedLayoutExplained(ledgerLayerFor(settings, database, wiring.projections.appends), settings),
      ),
      serve: async (runtime, ownOrigin) => {
        const { ledger, workflows, identityIssuer } = settings;
        const { stores, retryStateKeys, consent, connections, source, offering, clientMetadata } =
          await storesAndConnectionsOf(runtime, settings, database, ownOrigin);
        const { registry, withRegistryClosed } = await capabilityRegistryOpenedIn(runtime, {
          models: modelsComposedBy(settings, modelAccessOf, telemetry.models),
        });
        const functions = await functionsServedBy(runtime, settings, database, {
          ...wiring,
          ...(clock === undefined ? {} : { now: clock.now }),
          telemetry,
          registry,
          consent,
          connections: source,
          offering,
          shippedFiles,
        });
        const parts = {
          ledger,
          workflows,
          identityIssuer,
          retryStateKeys,
          shippedFiles,
          ...functions.parts,
          orgOperations: [...functions.parts.orgOperations, ...connections],
          ...(clock === undefined ? {} : { clock }),
        };
        const served = stores.withSecretsClosed(
          withRegistryClosed(functions.closing(await serveWorkflows(runtime, parts))),
        );
        return { ...served, routes: [...served.routes, clientMetadata] };
      },
    };
  });
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
