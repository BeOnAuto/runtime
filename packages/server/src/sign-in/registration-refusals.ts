import { ClientRegistrationError, type RegistrationRefusal } from '@on.auto/openid-connect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';

const byHand =
  'Auto with it by hand, giving the redirect URI {redirectUri}, then set OIDC_CLIENT_ID together with OIDC_CLIENT_SECRET or OIDC_CLIENT_SECRET_FILE';

function wordsOf(issuer: string, refusal: RegistrationRefusal): string {
  const provider = `The identity provider at ${issuer}`;
  if ('notOffered' in refusal) {
    return `OIDC_CLIENT_ID: ${provider} does not offer dynamic client registration. Register ${byHand}`;
  }
  if ('refused' in refusal) {
    return `OIDC_ISSUER: ${provider} refused to register Auto (${refusal.refused}). Register ${byHand}`;
  }
  if ('unreached' in refusal) {
    return `OIDC_ISSUER: Auto could not register with the identity provider at ${issuer}, since its registration endpoint ${refusal.unreached}. Start the server again once that is fixed, or register ${byHand}`;
  }
  return 'unusable' in refusal
    ? `OIDC_ISSUER: ${provider} registered Auto in a way Auto cannot use (${refusal.unusable}). Register ${byHand}`
    : `OIDC_SCOPES: ${provider} registered Auto without the scopes ${refusal.withoutScopes.join(' ')}. Set OIDC_SCOPES without them, or register ${byHand}`;
}

export function refusedAtStart(failure: unknown): unknown {
  if (!(failure instanceof ClientRegistrationError)) {
    return failure;
  }
  const { issuer, redirectUri, refusal } = failure;
  const message = wordsOf(issuer, refusal).replace('{redirectUri}', redirectUri);
  return new InvalidSettingsError({ message });
}
