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
import { functionWiringOf, type FunctionWiring, type ServedWiring } from './function-wiring.ts';
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
  readonly goals?: boolean;
  readonly goalsResults?: boolean;
  readonly goalsMessages?: boolean;
  readonly startingWork?: WorkflowParts['startingWork'];
  readonly consumersOf?: WorkflowParts['consumersOf'];
  readonly goalsPortsOver?: NonNullable<ServedWiring['goalsPortsOver']>;
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
  readonly goals: boolean;
  readonly results: boolean;
  readonly messages: boolean;
  readonly startingWork?: WorkflowParts['startingWork'];
  readonly consumersOf?: WorkflowParts['consumersOf'];
  readonly goalsPortsOver?: ServedWiring['goalsPortsOver'];
}

function optionalPartsOf({
  clock,
  startingWork,
  consumersOf,
}: Pick<Serving, 'clock' | 'startingWork' | 'consumersOf'>) {
  return {
    ...(clock === undefined ? {} : { clock }),
    ...(startingWork === undefined ? {} : { startingWork }),
    ...(consumersOf === undefined ? {} : { consumersOf }),
  };
}

function goalsWiringOf({ goals, results, messages, goalsPortsOver }: Serving) {
  return { goals, results, messages, goalsPortsOver };
}

function meterOf(
  settings: Composing[0],
  { signers, features }: Pick<CompositionParts, 'signers' | 'features'>,
): NonNullable<Parameters<typeof applicationLayer>[1]> {
  return {
    studio: settings.studio.origin,
    ...settings.license,
    ...(signers === undefined ? {} : { signers }),
    ...(features === undefined ? {} : { features }),
  };
}

function servedWith(serving: Serving): Awaited<ReturnType<ComposedServerOptions['composed']>>['serve'] {
  const { modelAccessOf, wiring, settings, telemetry, shippedFiles, database, made } = serving;
  return async (runtime, ownOrigin) => {
    const { ledger, workflows, identityIssuer } = settings;
    const { stores, consent, connections, source, offering, clientMetadata, license, ...ownKeys } =
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
      generation: { shippedFiles, contentAddressKey: ownKeys.contentAddressKey, ownOrigin },
      ...goalsWiringOf(serving),
    });
    made.bounds.keptFrom(functions.parts.capabilities);
    const parts = {
      ledger,
      workflows,
      identityIssuer,
      ...ownKeys,
      ...(settings.receiving.overHttp ? { answerStores: { ...stores, providers: settings.providers } } : {}),
      shippedFiles,
      ...functions.parts,
      orgOperations: [...functions.parts.orgOperations, ...connections, ...license.operations],
      dueWork: [...functions.parts.dueWork, ...license.dueWork],
      ...optionalPartsOf(serving),
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

function goalsSwitchesOf(
  goals: boolean,
  results = false,
  messages = false,
): Pick<Serving, 'goals' | 'results' | 'messages'> {
  return { goals, results: goals && results, messages: goals && results && messages };
}

export function compositionRootWith(
  modelAccessOf: ModelAccessOf,
  {
    programPoolOf,
    clock,
    toolTiming,
    signers,
    features,
    installed,
    goals = false,
    goalsResults,
    goalsMessages,
    ...goalsParts
  }: CompositionParts = {},
): ComposedServerOptions {
  const wiring = functionWiringOf(programPoolOf, toolTiming, clock?.now);
  return serverOptionsComposing(async (settings, telemetry, shippedFiles) => {
    const database = await ledgerDatabaseOf(settings, telemetry.appended);
    const made = await madeAtStart(settings, { programPoolOf: wiring.programPoolOf, shippedFiles, installed });
    const ledgerLayer = withARefusedLayoutExplained(
      ledgerLayerFor(settings, database, {
        declared: made.prediction.provided.capability.facts.onRuns,
        appends: wiring.projections.appends,
        mostActiveOf: made.bounds.mostActiveOf,
      }),
      settings,
    );
    const services = applicationLayer(ledgerLayer, meterOf(settings, { signers, features }), settings.payloads);
    return {
      services: made.computation.closedLastOf(made.registry.closedFirstOf(services)),
      serve: servedWith({
        modelAccessOf,
        wiring,
        clock,
        settings,
        telemetry,
        shippedFiles,
        database,
        made,
        ...goalsSwitchesOf(goals, goalsResults, goalsMessages),
        ...goalsParts,
      }),
    };
  });
}

export const compositionRoot = compositionRootWith(loggedModelAccess, { goals: true, goalsResults: true });
