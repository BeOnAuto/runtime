import { readPageStyle } from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import { authenticatorFor, configuredApiKeys, identityServiceOf } from '@on.auto/identity';

import type { RunningServer, ServerOptions } from '../server-options/server-options.ts';
import { readShippedSettings } from '../settings/served-settings.ts';
import { readSettings } from '../settings/settings.ts';
import { startTelemetry } from '../telemetry/start-telemetry.ts';
import { started } from './server-start.ts';

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const [shipped, pageStyle] = await Promise.all([
    readShippedSettings(options.shippedFiles),
    readPageStyle(options.shippedFiles),
  ]);
  const settings = readSettings(environment, shipped);
  const identityService =
    settings.signIn === undefined
      ? undefined
      : await identityServiceOf({
          ...settings.signIn,
          studio: settings.studio,
          allowedOrigins: settings.allowedOrigins,
        });
  const authenticator = authenticatorFor({
    ...settings,
    apiKeySource: configuredApiKeys(settings.apiKeys),
    identityService,
  });
  const telemetry = startTelemetry(settings.telemetry);
  try {
    return await started({ settings, authenticator, telemetry, options, pageStyle });
  } catch (failure) {
    await telemetry.shutdown();
    throw failure;
  }
}
