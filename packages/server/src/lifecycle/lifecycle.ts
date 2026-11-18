import { readPageStyle } from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import {
  authenticatorFor,
  configuredApiKeys,
  discoveredIssuerKeys,
  identityServiceOf,
  issuerKeysAt,
  issuerKeysGiven,
  type ApiKeySource,
  type Authenticator,
  type IdentityService,
  type IssuerKeySource,
} from '@on.auto/identity';

import type { RunningServer, ServerOptions } from '../server-options/server-options.ts';
import type { IdentityKeySet } from '../settings/access-settings.ts';
import { readShippedSettings } from '../settings/served-settings.ts';
import { readSettings, type Settings } from '../settings/settings.ts';
import { companySignInOf, signedInApiOf, signInRoutesOf, type CompanySignIn } from '../sign-in/company-sign-in.ts';
import { startTelemetry } from '../telemetry/start-telemetry.ts';
import { started } from './server-start.ts';

function issuerKeysOf(keySet: IdentityKeySet): IssuerKeySource {
  if (keySet.from === 'given') {
    return issuerKeysGiven(keySet.keySet);
  }
  return keySet.from === 'url' ? issuerKeysAt(keySet.url) : discoveredIssuerKeys;
}

function noTokenOfItsOwn(publicUrl: string): IdentityService {
  return {
    resource: { publicUrl, authorizationServers: [] },
    personOf: () => Promise.resolve({ because: undefined }),
  };
}

function companySignInAccess(settings: Settings, publicUrl: string, apiKeySource: ApiKeySource): Authenticator {
  const identityService = noTokenOfItsOwn(publicUrl);
  const { mode, authenticate } = authenticatorFor({ ...settings, apiKeySource, identityService });
  return { mode, resource: undefined, authenticate };
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
  readonly authenticator: Authenticator;
  readonly companySignIn: CompanySignIn | undefined;
}

async function admittingBy(settings: Settings): Promise<Admitting> {
  const apiKeySource = configuredApiKeys(settings.apiKeys);
  const { openIdConnect } = settings;
  if (openIdConnect === undefined) {
    return { authenticator: await identityServiceAccess(settings, apiKeySource), companySignIn: undefined };
  }
  return {
    authenticator: companySignInAccess(settings, openIdConnect.publicUrl, apiKeySource),
    companySignIn: await companySignInOf(openIdConnect),
  };
}

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const [shipped, pageStyle] = await Promise.all([
    readShippedSettings(options.shippedFiles),
    readPageStyle(options.shippedFiles),
  ]);
  const settings = readSettings(environment, shipped);
  const { authenticator, companySignIn } = await admittingBy(settings);
  const telemetry = startTelemetry(settings.telemetry);
  try {
    const signInRoutes = signInRoutesOf(companySignIn);
    const signedInApi = signedInApiOf(companySignIn);
    return await started({ settings, authenticator, signInRoutes, signedInApi, telemetry, options, pageStyle });
  } catch (failure) {
    await telemetry.shutdown();
    throw failure;
  }
}
