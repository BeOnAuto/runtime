import { madeAtStart, type MadeAtStart, type StartWiring } from '../capability-registry/made-at-start.ts';
import { storesAndConnectionsOf } from '../connections/served-connections.ts';
import {
  ledgerConnectionIn,
  ledgerDatabaseOf,
  withARefusedLayoutExplained,
  withHeldRequestsEndedFirst,
} from '../database/ledger-database.ts';
import { serverOptionsComposing, type ComposedServerOptions } from '../server-options/composed-options.ts';
import { serveWorkflows, type WorkflowParts } from '../workflows/workflows.ts';
import { applicationLayer, withLiveAttemptsClosedFirst } from './application-layer.ts';
import { functionWiringOf, type FunctionWiring } from './function-wiring.ts';
import { ledgerLayerFor } from './ledger-store.ts';
import { functionsServedBy } from './served-functions.ts';
import { loggedModelAccess, type ModelAccessOf } from './served-reasoning.ts';

export interface CompositionParts {
  readonly programPoolOf?: FunctionWiring['programPoolOf'];
  readonly clock?: WorkflowParts['clock'];
  readonly toolTiming?: FunctionWiring['toolTiming'];
  readonly signers?: NonNullable<Parameters<typeof applicationLayer>[1]>['signers'];
  readonly features?: NonNullable<Parameters<typeof applicationLayer>[1]>['features'];
  readonly installed?: NonNullable<StartWiring['installed']>;
}

type Composing = Parameters<ComposedServerOptions['composed']>;

interface Serving {
  readonly modelAccessOf: ModelAccessOf;
  readonly wiring: FunctionWiring;
  readonly clock: WorkflowParts['clock'];
  readonly settings: Composing[0];
  readonly telemetry: Composing[1];
  readonly shippedFiles: Composing[2];
  readonly database: Awaited<ReturnType<typeof ledgerDatabaseOf>>;
  readonly made: MadeAtStart;
}

function servedWith(serving: Serving): Awaited<ReturnType<ComposedServerOptions['composed']>>['serve'] {
  const { modelAccessOf, wiring, clock, settings, telemetry, shippedFiles, database, made } = serving;
  return async (runtime, ownOrigin) => {
    const { ledger, workflows, identityIssuer } = settings;
    const { stores, retryStateKeys, consent, connections, source, offering, clientMetadata, license } =
      await storesAndConnectionsOf(runtime, settings, database, ownOrigin);
    const registry = await made.registry.openedIn(runtime, settings, {
      ...wiring,
      modelAccessOf,
      telemetry,
      consent,
      connections: source,
    });
    await made.extensions.logged(runtime);
    const functions = await functionsServedBy(runtime, settings, await ledgerConnectionIn(runtime), {
      ...wiring,
      registry,
      connections: source,
      offering,
      computation: made.computation,
      prediction: made.prediction,
    });
    const parts = {
      ledger,
      workflows,
      identityIssuer,
      retryStateKeys,
      shippedFiles,
      ...functions.parts,
      orgOperations: [...functions.parts.orgOperations, ...connections, ...license.operations],
      dueWork: [...functions.parts.dueWork, ...license.dueWork],
      ...(clock === undefined ? {} : { clock }),
    };
    const served = stores.withSecretsClosed(
      registry.processes.withDocumentsClosed(await serveWorkflows(runtime, parts)),
    );
    const closing = await withHeldRequestsEndedFirst(
      runtime,
      license.withALastReport({ ...served, routes: [...served.routes, clientMetadata] }),
    );
    return { ...withLiveAttemptsClosedFirst(runtime, closing), licenseNotice: license.notice };
  };
}

export function compositionRootWith(
  modelAccessOf: ModelAccessOf,
  { programPoolOf, clock, toolTiming, signers, features, installed }: CompositionParts = {},
): ComposedServerOptions {
  const wiring = functionWiringOf(programPoolOf, toolTiming, clock?.now);
  return serverOptionsComposing(async (settings, telemetry, shippedFiles) => {
    const database = await ledgerDatabaseOf(settings, telemetry.appended);
    const made = await madeAtStart(settings, { programPoolOf: wiring.programPoolOf, shippedFiles, installed });
    const ledgerLayer = withARefusedLayoutExplained(
      ledgerLayerFor(settings, database, wiring.projections.appends),
      settings,
    );
    const meter = {
      studio: settings.studio.origin,
      ...settings.license,
      ...(signers === undefined ? {} : { signers }),
      ...(features === undefined ? {} : { features }),
    };
    return {
      services: made.computation.closedLastOf(made.registry.closedFirstOf(applicationLayer(ledgerLayer, meter))),
      serve: servedWith({ modelAccessOf, wiring, clock, settings, telemetry, shippedFiles, database, made }),
    };
  });
}

export const compositionRoot = compositionRootWith(loggedModelAccess);
