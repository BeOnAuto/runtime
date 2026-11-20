import { ClientRegistrationError, type RegistrationRefusal } from '@on.auto/openid-connect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';

const byHand =
  'Auto with it by hand, giving the redirect URI {redirectUri}, then set OIDC_CLIENT_ID together with OIDC_CLIENT_SECRET or OIDC_CLIENT_SECRET_FILE';

type Again = 'Start the server again' | 'Run this command again';

interface Worded {
  readonly setting: string;
  readonly happened: string;
  readonly remedy: string;
}

function wordedFor(issuer: string, refusal: RegistrationRefusal, again: Again): Worded {
  const provider = `The identity provider at ${issuer}`;
  if ('notOffered' in refusal) {
    return {
      setting: 'OIDC_CLIENT_ID',
      happened: `${provider} does not offer dynamic client registration`,
      remedy: `Register ${byHand}`,
    };
  }
  if ('refused' in refusal) {
    return {
      setting: 'OIDC_ISSUER',
      happened: `${provider} refused to register Auto (${refusal.refused})`,
      remedy: `Register ${byHand}`,
    };
  }
  if ('unreached' in refusal) {
    return {
      setting: 'OIDC_ISSUER',
      happened: `Auto could not register with the identity provider at ${issuer}, since its registration endpoint ${refusal.unreached}`,
      remedy: `${again} once that is fixed, or register ${byHand}`,
    };
  }
  return 'unusable' in refusal
    ? {
        setting: 'OIDC_ISSUER',
        happened: `${provider} registered Auto in a way Auto cannot use (${refusal.unusable})`,
        remedy: `Register ${byHand}`,
      }
    : {
        setting: 'OIDC_SCOPES',
        happened: `${provider} registered Auto without the scopes ${refusal.withoutScopes.join(' ')}`,
        remedy: `Set OIDC_SCOPES without them, or register ${byHand}`,
      };
}

type Failed = Pick<ClientRegistrationError, 'issuer' | 'redirectUri' | 'refusal'>;

function messageOf({ issuer, redirectUri, refusal }: Failed, again: Again): string {
  const { setting, happened, remedy } = wordedFor(issuer, refusal, again);
  return `${setting}: ${happened}. ${remedy.replace('{redirectUri}', redirectUri)}`;
}

function messageByDefaultOf({ issuer, refusal }: Failed, again: Again): string {
  return `${wordedFor(issuer, refusal, again).happened}. ${again} once that is fixed.`;
}

export function refusedAtStart(failure: unknown): unknown {
  return failure instanceof ClientRegistrationError
    ? new InvalidSettingsError({ message: messageOf(failure, 'Start the server again') })
    : failure;
}

export function refusedToACommand(failure: unknown, byDefault: boolean): string {
  if (!(failure instanceof ClientRegistrationError)) {
    return String(Reflect.get(new Object(failure), 'message'));
  }
  const worded = byDefault ? messageByDefaultOf : messageOf;
  return worded(failure, 'Run this command again');
}
