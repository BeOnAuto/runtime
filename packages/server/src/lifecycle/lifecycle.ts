import { readPageStyle } from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import {
  authenticatorFor,
  configuredApiKeys,
  discoveredIssuerKeys,
  identityServiceOf,
  issuerKeysAt,
  issuerKeysGiven,
  type AccessMode,
  type ApiKeySource,
  type Authenticator,
  type IdentityService,
  type IssuerKeySource,
} from '@on.auto/identity';

import type { RunningServer, ServerOptions } from '../server-options/server-options.ts';
import { readSettings, type Settings } from '../settings/settings.ts';
import { readShippedSettings } from '../settings/shipped-settings.ts';
import { companySignInOf, type CompanySignIn } from '../sign-in/company-client.ts';
import { signInServingOf } from '../sign-in/company-sign-in.ts';
import { startTelemetry } from '../telemetry/start-telemetry.ts';
import { started } from './server-start.ts';

function issuerKeysOf(keySet: Settings['identityKeySet']): IssuerKeySource {
  if (keySet.from === 'given') {
    return issuerKeysGiven(keySet.keySet);
  }
  return keySet.from === 'url' ? issuerKeysAt(keySet.url) : discoveredIssuerKeys;
}

async function identityServiceAccess(settings: Settings, apiKeySource: ApiKeySource): Promise<Authenticator> {
  const identityService =
    settings.signIn === undefined
      ? undefined
      : await identityServiceOf({
          ...settings.signIn,
          studio: settings.studio,
          allowedOrigins: settings.allowedOrigins,
          issuerKeys: issuerKeysOf(settings.identityKeySet),
        });
  return authenticatorFor({ ...settings, apiKeySource, identityService });
}

interface Admitting {
  readonly mode: AccessMode;
  readonly answering: (identityService: IdentityService | undefined) => Authenticator;
  readonly companySignIn: CompanySignIn | undefined;
}

const signingPeopleIn: AccessMode = 'credentials';

async function admittingBy(settings: Settings): Promise<Admitting> {
  const apiKeySource = configuredApiKeys(settings.apiKeys);
  const { openIdConnect } = settings;
  if (openIdConnect === undefined) {
    const authenticator = await identityServiceAccess(settings, apiKeySource);
    return { mode: authenticator.mode, answering: () => authenticator, companySignIn: undefined };
  }
  return {
    mode: signingPeopleIn,
    answering: (identityService) => authenticatorFor({ ...settings, apiKeySource, identityService }),
    companySignIn: await companySignInOf(openIdConnect),
  };
}

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const [shipped, pageStyle] = await Promise.all([
    readShippedSettings(options.shippedFiles),
    readPageStyle(options.shippedFiles),
  ]);
  const settings = readSettings(environment, shipped);
  const { mode, answering, companySignIn } = await admittingBy(settings);
  const telemetry = startTelemetry(settings.telemetry);
  try {
    const signInServing = signInServingOf(companySignIn);
    return await started({ settings, mode, answering, signInServing, telemetry, options, pageStyle });
  } catch (failure) {
    await telemetry.shutdown();
    throw failure;
  }
}
