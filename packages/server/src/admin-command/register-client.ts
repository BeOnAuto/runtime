import type { ProviderRequests } from '@on.auto/openid-connect';

import { ledgerStoresOpenedBy } from '../database/ledger-stores.ts';
import { servedBy } from '../server-options/server-options.ts';
import type { OpenIdConnectSettings } from '../settings/openid-connect-settings.ts';
import { registeringProviderFor } from '../sign-in/company-client.ts';
import { registeredAgain, type KeptInPlace } from '../sign-in/registered-clients.ts';
import { refusedToACommand } from '../sign-in/registration-refusals.ts';
import {
  clientGivenBySetting,
  clientRegistered,
  clientRegisteredElsewhereFirst,
  noOneSignsIn,
  out,
  refused,
  type Said,
} from './admin-words.ts';
import { byACommand, type Opened, type OpeningOf } from './opened-for-a-command.ts';

interface Registering extends Pick<Opened, 'settings' | 'runtime' | 'database'> {
  readonly signIn: Pick<Opened['signIn'], 'clientRegistrationsWith'>;
}

interface SigningIn {
  readonly settings: OpenIdConnectSettings;
  readonly byDefault: boolean;
  readonly requests: ProviderRequests;
}

function saidOf(issuer: string, { inUse, registered, recordedFirstElsewhere, replacing }: KeptInPlace): Said {
  return out(
    recordedFirstElsewhere
      ? clientRegisteredElsewhereFirst(issuer, inUse.clientId, registered.clientId)
      : clientRegistered(issuer, inUse.clientId, replacing),
  );
}

async function registeredIn(
  { settings, byDefault, requests }: SigningIn,
  { settings: all, runtime, database, signIn }: Registering,
): Promise<Said> {
  const stores = await ledgerStoresOpenedBy(runtime.context, all, database);
  try {
    const provider = await registeringProviderFor(settings, byDefault, requests);
    const kept = await registeredAgain(provider, signIn.clientRegistrationsWith(stores.secrets, byACommand));
    return saidOf(provider.issuer, kept);
  } catch (failure) {
    return refused(refusedToACommand(failure, byDefault));
  } finally {
    await stores.withSecretsClosed(servedBy([])).stopWork();
  }
}

export function clientRegisteredBy(
  { openIdConnect, openIdConnectByDefault }: Opened['settings'],
  requests: ProviderRequests,
  open: OpeningOf<Registering>,
): Promise<Said> {
  if (openIdConnect?.client !== undefined) {
    return Promise.resolve(refused(clientGivenBySetting));
  }
  const settings = openIdConnect ?? openIdConnectByDefault;
  if (settings === undefined) {
    return Promise.resolve(refused(noOneSignsIn));
  }
  return open((opened) => registeredIn({ settings, byDefault: openIdConnect === undefined, requests }, opened));
}
