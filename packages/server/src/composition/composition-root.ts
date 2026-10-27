import { capabilityRegistryHeld } from '../capability-registry/capability-registry.ts';
import { storesAndConnectionsOf } from '../connections/served-connections.ts';
import { ledgerConnectionIn, ledgerDatabaseOf, withARefusedLayoutExplained } from '../database/ledger-database.ts';
import { serverOptionsComposing, type ComposedServerOptions } from '../server-options/composed-options.ts';
import { serveWorkflows, type WorkflowParts } from '../workflows/workflows.ts';
import { applicationLayer, withLiveAttemptsClosedFirst } from './application-layer.ts';
import { functionWiringOf, type FunctionWiring } from './function-wiring.ts';
import { ledgerLayerFor } from './ledger-store.ts';
import { functionsServedBy } from './served-functions.ts';
import { loggedModelAccess, type ModelAccessOf } from './served-reasoning.ts';

export function compositionRootWith(
  modelAccessOf: ModelAccessOf,
  programPoolOf?: FunctionWiring['programPoolOf'],
  clock?: WorkflowParts['clock'],
  toolTiming?: FunctionWiring['toolTiming'],
): ComposedServerOptions {
  const wiring = functionWiringOf(programPoolOf, toolTiming, clock?.now);
  return serverOptionsComposing(async (settings, telemetry, shippedFiles) => {
    const database = await ledgerDatabaseOf(settings, telemetry.appended);
    const capabilities = capabilityRegistryHeld();
    const ledgerLayer = withARefusedLayoutExplained(
      ledgerLayerFor(settings, database, wiring.projections.appends),
      settings,
    );
    return {
      services: capabilities.closedFirstOf(applicationLayer(ledgerLayer, settings.studio.origin)),
      serve: async (runtime, ownOrigin) => {
        const { ledger, workflows, identityIssuer } = settings;
        const { stores, retryStateKeys, consent, connections, source, offering, clientMetadata } =
          await storesAndConnectionsOf(runtime, settings, database, ownOrigin);
        const registry = await capabilities.openedIn(runtime, settings, {
          ...wiring,
          modelAccessOf,
          telemetry,
          consent,
          connections: source,
        });
        const functions = await functionsServedBy(runtime, settings, await ledgerConnectionIn(runtime), {
          ...wiring,
          registry,
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
        const served = stores.withSecretsClosed(functions.closing(await serveWorkflows(runtime, parts)));
        return withLiveAttemptsClosedFirst(runtime, { ...served, routes: [...served.routes, clientMetadata] });
      },
    };
  });
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
