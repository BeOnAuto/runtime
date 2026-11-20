import { readPageStyle } from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import {
  authenticatorFor,
  configuredApiKeys,
  type AccessMode,
  type Authenticator,
  type IdentityService,
} from '@on.auto/identity';

import type { RunningServer, ServerOptions } from '../server-options/server-options.ts';
import type { Settings } from '../settings/settings.ts';
import { settingsAtStart } from '../settings/shipped-settings.ts';
import { companySignInOf, signInByDefaultOf, type CompanySignIn } from '../sign-in/company-client.ts';
import { signInServingOf } from '../sign-in/company-sign-in.ts';
import { startTelemetry } from '../telemetry/start-telemetry.ts';
import { started } from './server-start.ts';

interface Admitting {
  readonly mode: AccessMode;
  readonly answering: (identityService: IdentityService | undefined) => Authenticator;
  readonly companySignIn: CompanySignIn | undefined;
}

const signingPeopleIn: AccessMode = 'credentials';

function companySignInBy({ openIdConnect, openIdConnectByDefault }: Settings): Promise<CompanySignIn | undefined> {
  if (openIdConnect !== undefined) {
    return companySignInOf(openIdConnect);
  }
  return Promise.resolve(openIdConnectByDefault === undefined ? undefined : signInByDefaultOf(openIdConnectByDefault));
}

async function admittingBy(settings: Settings): Promise<Admitting> {
  const apiKeySource = configuredApiKeys(settings.apiKeys);
  const companySignIn = await companySignInBy(settings);
  if (companySignIn === undefined) {
    const authenticator = authenticatorFor({ ...settings, apiKeySource });
    return { mode: authenticator.mode, answering: () => authenticator, companySignIn };
  }
  return {
    mode: signingPeopleIn,
    answering: (identityService) => authenticatorFor({ ...settings, apiKeySource, identityService }),
    companySignIn,
  };
}

export async function startServer<R>(environment: Environment, options: ServerOptions<R>): Promise<RunningServer> {
  const [settings, pageStyle] = await Promise.all([
    settingsAtStart(environment, options.shippedFiles, options.defaultIdentityProvider),
    readPageStyle(options.shippedFiles),
  ]);
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
