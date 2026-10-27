import { capabilityRegistryHeld } from '../capability-registry/capability-registry.ts';
import { storesAndConnectionsOf } from '../connections/served-connections.ts';
import { ledgerConnectionIn, ledgerDatabaseOf } from '../database/ledger-database.ts';
import { runtimeMeter, type RuntimeMeterOptions } from '../metering/runtime-meter.ts';
import { serverOptionsComposing, type ComposedServerOptions } from '../server-options/composed-options.ts';
import { serveWorkflows, type WorkflowParts } from '../workflows/workflows.ts';
import { applicationLayerOn, withLiveAttemptsClosedFirst } from './application-layer.ts';
import { functionWiringOf, type FunctionWiring } from './function-wiring.ts';
import { functionsServedBy } from './served-functions.ts';
import { loggedModelAccess, type ModelAccessOf } from './served-reasoning.ts';

interface CompositionOptions {
  readonly programPoolOf?: FunctionWiring['programPoolOf'];
  readonly clock?: WorkflowParts['clock'];
  readonly toolTiming?: FunctionWiring['toolTiming'];
  readonly metering?: RuntimeMeterOptions;
}

export function compositionRootWith(
  modelAccessOf: ModelAccessOf,
  { programPoolOf, clock, toolTiming, metering }: CompositionOptions = {},
): ComposedServerOptions {
  const wiring = functionWiringOf(programPoolOf, toolTiming, clock?.now);
  return serverOptionsComposing(async (settings, telemetry, shippedFiles) => {
    const database = await ledgerDatabaseOf(settings, telemetry.appended);
    const capabilities = capabilityRegistryHeld();
    return {
      services: capabilities.closedFirstOf(applicationLayerOn(settings, database, wiring.projections.appends)),
      serve: async (original, ownOrigin) => {
        const { ledger, workflows, identityIssuer } = settings;
        const { stores, retryStateKeys, consent, connections, source, offering, clientMetadata } =
          await storesAndConnectionsOf(original, settings, database, ownOrigin);
        const connection = await ledgerConnectionIn(original);
        const meter = await runtimeMeter(original, { connection, secrets: stores.secrets }, metering);
        const { runtime } = meter;
        const registry = await capabilities.openedIn(runtime, settings, {
          ...wiring,
          modelAccessOf,
          telemetry,
          consent,
          connections: source,
        });
        const functions = await functionsServedBy(runtime, settings, connection, {
          ...wiring,
          registry,
          connections: source,
          offering,
          shippedFiles,
          cloudDevelopmentOnly: metering !== undefined,
        });
        const parts = {
          ledger,
          workflows,
          identityIssuer,
          retryStateKeys,
          shippedFiles,
          ...functions.parts,
          dueWork: [...functions.parts.dueWork, ...meter.dueWork],
          orgOperations: [...functions.parts.orgOperations, ...connections],
          ...(clock === undefined ? {} : { clock }),
        };
        const served = stores.withSecretsClosed(functions.closing(meter.closing(await serveWorkflows(runtime, parts))));
        return withLiveAttemptsClosedFirst(runtime, { ...served, routes: [...served.routes, clientMetadata] });
      },
    };
  });
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
