import { installationIdPlaceholder } from '@on.auto/providers';
import type { ServerEntryFields } from '@on.auto/tool-servers';
import { Option } from 'effect';

import type { Credential } from '../registry/credential.ts';
import { literalText } from './literal-values.ts';

const kindsMintingTokens: ReadonlySet<string> = new Set(['client_credentials', 'jwt_bearer']);

export interface Installing {
  readonly credential: Credential;
  readonly installation?: { readonly id: string } | undefined;
}

export function mintsItsTokens({ kind, installation }: Credential): boolean {
  return kindsMintingTokens.has(kind) || installation !== undefined;
}

export function signsAnAssertion({ kind, installation }: Credential): boolean {
  return kind === 'jwt_bearer' || installation !== undefined;
}

export function issuerOf({ issuer, installation }: Credential): string {
  return installation?.issuer ?? Option.getOrThrow(Option.fromNullishOr(issuer));
}

function installedRequestOf({ credential, installation }: Installing): NonNullable<Credential['token_request']> {
  const request = Option.getOrThrow(Option.fromNullishOr(credential.installation)).token_request;
  const id = encodeURIComponent(Option.getOrThrow(Option.fromNullishOr(installation)).id);
  return { ...request, url: request.url.replace(`{${installationIdPlaceholder}}`, id) };
}

type Granted = Pick<NonNullable<ServerEntryFields['auth']>, 'grant' | 'subject' | 'token_request'>;

function requestedOf({ token_request: request }: Pick<Credential, 'token_request'>): Pick<Granted, 'token_request'> {
  if (request === undefined) {
    return {};
  }
  const { method, url, issued } = request;
  const { access_token: accessToken, expires_at: expiresAt } = issued;
  const ending = expiresAt === undefined ? {} : { expires_at: literalText(expiresAt) };
  return {
    token_request: { method, url: literalText(url), issued: { access_token: literalText(accessToken), ...ending } },
  };
}

export function grantOf(credentialled: Installing): Granted {
  const { credential } = credentialled;
  const { kind, subject } = credential;
  if (credential.installation !== undefined) {
    return { grant: 'jwt_bearer', ...requestedOf({ token_request: installedRequestOf(credentialled) }) };
  }
  if (kind !== 'jwt_bearer') {
    return {};
  }
  const named = subject === undefined ? {} : { subject: literalText(subject) };
  return { grant: kind, ...named, ...requestedOf(credential) };
}
