import { createApiHandler, type ApiHandler, type AppRuntime, type PageStyle } from '@on.auto/api';

import { incidentsLoggedIn, logStudioKeptInMemory } from '../logging/logging.ts';
import { storeReadsWatched } from '../logging/store-reads-logging.ts';
import type { LocalServing, Served, StartPing } from '../server-options/server-options.ts';
import type { Settings } from '../settings/settings.ts';
import { servedStudioOf } from '../studio/served-studio.ts';
import type { Telemetry } from '../telemetry/start-telemetry.ts';
import type { answeringBy } from './served-sign-in.ts';

export interface Answering<R> {
  readonly settings: Settings;
  readonly authenticator: ReturnType<typeof answeringBy>;
  readonly served: Served;
  readonly runtime: AppRuntime<R>;
  readonly telemetry: Telemetry;
  readonly local: LocalServing | undefined;
  readonly startPing: StartPing;
  readonly pageStyle: PageStyle;
}

type Requests = NonNullable<Served['observedRequests']>;

/** The middleware the API runs first, each where it is given, the first outermost. */
function requestsWatched(...watching: readonly (Requests | undefined)[]): { readonly requests?: Requests } {
  const given = watching.filter((watched) => watched !== undefined);
  const [first, ...rest] = given;
  if (first === undefined) {
    return {};
  }
  return {
    requests: rest.reduce<Requests>(
      (outer, inner) => (context, next) =>
        outer(context, async () => {
          await inner(context, next);
        }),
      first,
    ),
  };
}

export function apiOf<R>(answering: Answering<R>): ApiHandler {
  const { settings, authenticator, served, runtime, telemetry, local, startPing, pageStyle } = answering;
  const { licenseNotice, routes, callContext } = served;
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
    reportIncident: incidentsLoggedIn(runtime),
    ...requestsWatched(
      telemetry.requests,
      served.observedRequests,
      storeReadsWatched({
        logLevel: settings.logLevel,
        traced: telemetry.requests !== undefined,
        run: runtime.run,
      }),
    ),
    ...(local?.runtimeControl === undefined ? {} : { runtimeControl: local.runtimeControl }),
    installId: startPing.installId,
    ...(authenticator.mode === 'local' && licenseNotice !== undefined ? { licenseNotice } : {}),
    ...(callContext === undefined ? {} : { callContext }),
  });
}
