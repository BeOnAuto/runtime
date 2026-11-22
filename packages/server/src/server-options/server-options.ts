import type { ApiEnv, AppRuntime, CallContext, RegisterRoutes, RuntimeControl } from '@on.auto/api';
import type { AccessMode, DefaultIdentityProvider, SignInSettings, StudioSettings } from '@on.auto/identity';
import type { ShippedFiles } from '@on.auto/shipped-files';
import type { Layer } from 'effect';
import type { MiddlewareHandler } from 'hono';

import type { Settings } from '../settings/settings.ts';
import type { SignInServed } from '../sign-in/company-sign-in.ts';
import type { Telemetry } from '../telemetry/start-telemetry.ts';

export interface Install {
  readonly id: string;
  readonly isNew: boolean;
}

export interface StartPing {
  readonly installId: () => string | undefined;
  readonly sent: () => Install | undefined;
  readonly stop: () => void;
}

export type UsagePing = (settings: Pick<Settings, 'usagePing' | 'ledger'>) => StartPing | undefined;

export type LicenseNotice = () => Promise<string | undefined>;

export interface RunningServer {
  readonly port: number;
  readonly publicUrl: string | undefined;
  readonly mode: AccessMode;
  readonly signIn: SignInSettings | undefined;
  readonly studio: StudioSettings;
  readonly install: Install | undefined;
  readonly licenseNotice?: LicenseNotice;
  stop(): Promise<void>;
}

export interface Served extends SignInServed {
  readonly routes: readonly RegisterRoutes[];
  readonly stopWork: () => Promise<void>;
  readonly licenseNotice?: LicenseNotice;
  readonly callContext?: CallContext;
  /** Middleware that sees each request after the telemetry's own: what a test watches to know a request ended. */
  readonly observedRequests?: MiddlewareHandler<ApiEnv>;
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
  readonly composed: (
    settings: Settings,
    telemetry: Telemetry,
    shippedFiles: ShippedFiles,
  ) => Composed<R> | Promise<Composed<R>>;
  readonly shutdownTimeoutMs: number;
  readonly exitDeadlineMs: number;
  readonly shippedFiles: ShippedFiles;
  readonly localServingIn?: (mode: AccessMode) => LocalServing;
  readonly usagePing?: UsagePing;
  readonly defaultIdentityProvider?: DefaultIdentityProvider;
}

export function servedBy(routes: readonly RegisterRoutes[]): Served {
  return { routes, stopWork: () => Promise.resolve() };
}
