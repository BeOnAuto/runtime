import { createApiHandler, makeAppRuntime, type ApiHandler, type AppRuntime, type PageStyle } from '@on.auto/api';
import { Data, Effect, Function, Layer } from 'effect';

import {
  logAccessMode,
  logConfigFile,
  logIncident,
  logServedStudio,
  logStudioKeptInMemory,
  logTelemetry,
  serverLogs,
  type LogSettings,
} from '../logging/logging.ts';
import type {
  Composed,
  LocalServing,
  RunningServer,
  Served,
  ServerOptions,
  StartPing,
} from '../server-options/server-options.ts';
import type { Settings } from '../settings/settings.ts';
import { servedStudioOf } from '../studio/served-studio.ts';
import type { Telemetry } from '../telemetry/start-telemetry.ts';
import { beside, createHttpServer, listen, ownOriginOf, tcpPort } from './http-server.ts';
import { answeringBy, signInServedOn, type SignInServing, type SigningInAtStart } from './served-sign-in.ts';
import { shutDown } from './shutdown.ts';

class StartupError extends Data.TaggedError('StartupError')<{
  readonly message: string;
  readonly cause: unknown;
}> {}

interface Starting<R> extends SigningInAtStart {
  readonly settings: Settings;
  readonly telemetry: Telemetry;
  readonly options: ServerOptions<R>;
  readonly pageStyle: PageStyle;
}

async function servedOf<R>(composed: Composed<R>, runtime: AppRuntime<R>, ownOrigin: () => string): Promise<Served> {
  try {
    return await composed.serve(runtime, ownOrigin);
  } catch (failure) {
    await runtime.dispose();
    throw failure;
  }
}

async function startRuntime<R>(
  services: Layer.Layer<R>,
  logs: LogSettings,
  telemetry: Layer.Layer<never>,
): Promise<AppRuntime<R>> {
  try {
    return await makeAppRuntime(services.pipe(Layer.provideMerge(telemetry), Layer.provideMerge(serverLogs(logs))));
  } catch (failure) {
    throw new StartupError({ message: `The server's services could not start: ${String(failure)}`, cause: failure });
  }
}

function settingsServing(settings: Settings, local: LocalServing | undefined): Settings {
  return local === undefined ? settings : { ...settings, providerSetup: local.providerSetup };
}

function telemetryServing(telemetry: Telemetry, local: LocalServing | undefined): Telemetry {
  const counting = local?.appended;
  if (counting === undefined) {
    return telemetry;
  }
  const traced = telemetry.appended;
  return {
    ...telemetry,
    appended: {
      appended: (stream, events, place) => {
        traced?.appended(stream, events, place);
        counting.appended(stream, events, place);
      },
    },
  };
}

interface Answering<R> {
  readonly settings: Settings;
  readonly authenticator: ReturnType<typeof answeringBy>;
  readonly served: Served;
  readonly runtime: AppRuntime<R>;
  readonly telemetry: Telemetry;
  readonly local: LocalServing | undefined;
  readonly startPing: StartPing;
  readonly pageStyle: PageStyle;
}

function apiOf<R>(answering: Answering<R>): ApiHandler {
  const { settings, authenticator, served, runtime, telemetry, local, startPing, pageStyle } = answering;
  const { licenseNotice, routes } = served;
  return createApiHandler({
    allowedOrigins: settings.allowedOrigins,
    studio: servedStudioOf(settings, {
      report: (problem) => {
        void runtime.run(logStudioKeptInMemory(problem));
      },
    }),
    authenticator,
    routes,
    pageStyle,
    reportIncident: (id, error, requestId, call) => {
      void runtime.run(logIncident({ id, original: error, call }).pipe(Effect.annotateLogs({ requestId })));
    },
    ...(telemetry.requests === undefined ? {} : { requests: telemetry.requests }),
    ...(local?.runtimeControl === undefined ? {} : { runtimeControl: local.runtimeControl }),
    installId: startPing.installId,
    ...(authenticator.mode === 'local' && licenseNotice !== undefined ? { licenseNotice } : {}),
  });
}

interface Serving<R> {
  readonly composed: Composed<R>;
  readonly runtime: AppRuntime<R>;
  readonly ownOrigin: () => string;
}

async function servedSigningIn<R>(
  starting: SigningInAtStart,
  { composed, runtime, ownOrigin }: Serving<R>,
): Promise<{ readonly served: Served; readonly signIn: SignInServing | undefined }> {
  const served = await servedOf(composed, runtime, ownOrigin);
  try {
    return { served, signIn: await signInServedOn(starting, runtime, served) };
  } catch (failure) {
    await served.stopWork();
    await runtime.dispose();
    throw failure;
  }
}

const noStartPing: StartPing = {
  installId: Function.constUndefined,
  sent: Function.constUndefined,
  stop: Function.constVoid,
};

function composedFor<R>(
  { settings, telemetry, options }: Starting<R>,
  local: LocalServing | undefined,
): Composed<R> | Promise<Composed<R>> {
  return options.composed(settingsServing(settings, local), telemetryServing(telemetry, local), options.shippedFiles);
}

export async function started<R>(starting: Starting<R>): Promise<RunningServer> {
  const { settings, mode, telemetry, options } = starting;
  const local = options.localServingIn?.(mode);
  const composed = await composedFor(starting, local);
  const runtime = await startRuntime(composed.services, settings, telemetry.layer);
  await runtime.run(logAccessMode({ ...settings, mode }));
  await runtime.run(logServedStudio({ ...settings, mode }));
  await runtime.run(logConfigFile(settings.configFile));
  await runtime.run(logTelemetry(settings.telemetry));
  const listening = { port: settings.port };
  const ownOrigin = (): string => settings.publicUrl ?? ownOriginOf(settings.host, listening.port);
  const { served, signIn } = await servedSigningIn(starting, { composed, runtime, ownOrigin });
  const startPing = options.usagePing?.(settings) ?? noStartPing;
  const api = apiOf({ ...starting, authenticator: answeringBy(starting, signIn), served, runtime, local, startPing });
  const server = createHttpServer(signIn === undefined ? api.listener : beside(signIn, api.listener));
  try {
    await listen(server, settings.port, settings.host);
  } catch (error) {
    await served.stopWork();
    await runtime.dispose();
    await api.close();
    throw error;
  }
  listening.port = tcpPort(server.address());
  const install = startPing.sent();
  let stopping: Promise<void> | undefined;
  return {
    port: listening.port,
    publicUrl: settings.publicUrl,
    mode,
    signIn: settings.signIn,
    studio: settings.studio,
    install,
    ...(served.licenseNotice === undefined ? {} : { licenseNotice: served.licenseNotice }),
    stop: async () => {
      startPing.stop();
      stopping ??= shutDown(
        server,
        {
          stopWork: served.stopWork,
          disposeRuntime: runtime.dispose,
          stopTelemetry: telemetry.shutdown,
          closeApi: api.close,
        },
        options.shutdownTimeoutMs,
      );
      await stopping;
    },
  };
}
