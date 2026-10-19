import {
  createApiHandler,
  makeAppRuntime,
  type ApiHandler,
  type RegisterRoutes,
  type AppRuntime,
  type RuntimeControl,
} from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import {
  authenticatorFor,
  identityServiceOf,
  type AccessMode,
  type Authenticator,
  type SignInSettings,
  type StudioSettings,
} from '@on.auto/identity';
import { Data, Effect, Layer } from 'effect';

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
import { readSettings, type Settings } from '../settings/settings.ts';
import { servedStudioOf } from '../studio/served-studio.ts';
import { startTelemetry, type Telemetry } from '../telemetry/start-telemetry.ts';
import { createHttpServer, listen, ownOriginOf, tcpPort } from './http-server.ts';
import { exitDeadlineMs, shutDown, shutdownTimeoutMs } from './shutdown.ts';

class StartupError extends Data.TaggedError('StartupError')<{
  readonly message: string;
}> {}

export interface RunningServer {
  readonly port: number;
  readonly mode: AccessMode;
  readonly signIn: SignInSettings | undefined;
  readonly studio: StudioSettings;
  stop(): Promise<void>;
}

export interface Served {
  readonly routes: readonly RegisterRoutes[];
  readonly stopWork: () => Promise<void>;
}

export type ServedClosing = (served: Served) => Served;

export interface Composed<R> {
  readonly services: Layer.Layer<R>;
  readonly serve: (runtime: AppRuntime<R>, ownOrigin: () => string) => Served | Promise<Served>;
}

export interface LocalServing {
  readonly runtimeControl?: RuntimeControl;
  readonly providerSetup: string;
  readonly appended?: NonNullable<Telemetry['appended']>;
}

export interface ServerOptions<R> {
  readonly composed: (settings: Settings, telemetry: Telemetry) => Composed<R>;
  readonly shutdownTimeoutMs: number;
  readonly exitDeadlineMs: number;
  readonly localServingIn?: (mode: AccessMode) => LocalServing;
}

export function servedBy(routes: readonly RegisterRoutes[]): Served {
  return { routes, stopWork: () => Promise.resolve() };
}

export const defaultServerOptions: ServerOptions<never> = {
  composed: () => ({ services: Layer.empty, serve: () => servedBy([]) }),
  shutdownTimeoutMs,
  exitDeadlineMs,
};

interface Starting<R> {
  readonly settings: Settings;
  readonly authenticator: Authenticator;
  readonly telemetry: Telemetry;
  readonly options: ServerOptions<R>;
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
    throw new StartupError({ message: `The server's services could not start: ${String(failure)}` });
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
  readonly authenticator: Authenticator;
  readonly routes: readonly RegisterRoutes[];
  readonly runtime: AppRuntime<R>;
  readonly telemetry: Telemetry;
  readonly local: LocalServing | undefined;
}

function apiOf<R>({ settings, authenticator, routes, runtime, telemetry, local }: Answering<R>): ApiHandler {
  return createApiHandler({
    allowedOrigins: settings.allowedOrigins,
    studio: servedStudioOf(settings, {
      report: (problem) => {
        void runtime.run(logStudioKeptInMemory(problem));
      },
    }),
    authenticator,
    routes,
    reportIncident: (id, error, requestId, call) => {
      void runtime.run(logIncident({ id, original: error, call }).pipe(Effect.annotateLogs({ requestId })));
    },
    ...(telemetry.requests === undefined ? {} : { requests: telemetry.requests }),
    ...(local?.runtimeControl === undefined ? {} : { runtimeControl: local.runtimeControl }),
  });
}

async function started<R>({ settings, authenticator, telemetry, options }: Starting<R>): Promise<RunningServer> {
  const local = options.localServingIn?.(authenticator.mode);
  const composed = options.composed(settingsServing(settings, local), telemetryServing(telemetry, local));
  const runtime = await startRuntime(composed.services, settings, telemetry.layer);
  await runtime.run(logAccessMode({ ...settings, mode: authenticator.mode }));
  await runtime.run(logServedStudio({ ...settings, mode: authenticator.mode }));
  await runtime.run(logConfigFile(settings.configFile));
  await runtime.run(logTelemetry(settings.telemetry));
  const listening = { port: settings.port };
  const served = await servedOf(
    composed,
    runtime,
    () => settings.publicUrl ?? ownOriginOf(settings.host, listening.port),
  );
  const api = apiOf({ settings, authenticator, routes: served.routes, runtime, telemetry, local });
  const server = createHttpServer(api.listener);
  try {
    await listen(server, settings.port, settings.host);
  } catch (error) {
    await served.stopWork();
    await runtime.dispose();
    await api.close();
    throw error;
  }
  listening.port = tcpPort(server.address());
  let stopping: Promise<void> | undefined;
  return {
    port: listening.port,
    mode: authenticator.mode,
    signIn: settings.signIn,
    studio: settings.studio,
    stop: async () => {
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

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const settings = readSettings(environment);
  const identityService =
    settings.signIn === undefined
      ? undefined
      : await identityServiceOf({
          ...settings.signIn,
          studio: settings.studio,
          allowedOrigins: settings.allowedOrigins,
        });
  const authenticator = authenticatorFor({ ...settings, identityService });
  const telemetry = startTelemetry(settings.telemetry);
  try {
    return await started({ settings, authenticator, telemetry, options });
  } catch (failure) {
    await telemetry.shutdown();
    throw failure;
  }
}
