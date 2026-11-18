import { Redacted } from 'effect';

import type { TokenSource } from '../clients/token-source.ts';
import { isResourceOf } from '../consent/server-metadata.ts';
import { isUnderBase } from '../openapi/api-requests.ts';
import type { LinkedServerSettings } from '../openapi/described-api.ts';

interface TokenAudience {
  readonly recordedResources: readonly string[];
  readonly unnamedResourceBase: string | undefined;
}

export type Bearer =
  | { readonly kind: 'key'; readonly token: Redacted.Redacted }
  | { readonly kind: 'token'; readonly tokens: TokenSource; readonly audience: TokenAudience };

const bearerCredentials = /^bearer +(\S+)$/iu;

const authorizationHeader = 'authorization';

const noKeptTokenRecordsItsResources: readonly string[] = [];

function placedKeyIn(headers: ReadonlyMap<string, Redacted.Redacted>): Redacted.Redacted | undefined {
  const placed = [...headers].find(
    ([name]: readonly [string, Redacted.Redacted]) => name.toLowerCase() === authorizationHeader,
  );
  const credentials = placed === undefined ? null : bearerCredentials.exec(Redacted.value(placed[1]));
  return credentials === null ? undefined : Redacted.make(String(credentials[1]));
}

function audienceOf(settings: LinkedServerSettings): TokenAudience {
  return {
    recordedResources: noKeptTokenRecordsItsResources,
    unnamedResourceBase: settings.type === 'openapi' ? settings.api.baseUrl : undefined,
  };
}

export function bearerOf(settings: LinkedServerSettings, tokens?: TokenSource): Bearer | undefined {
  if (tokens !== undefined) {
    return { kind: 'token', tokens, audience: audienceOf(settings) };
  }
  const key = settings.type === 'stdio' ? undefined : placedKeyIn(settings.headers);
  return key === undefined ? undefined : { kind: 'key', token: key };
}

function isCoveredBy({ recordedResources, unnamedResourceBase }: TokenAudience, url: Readonly<URL>): boolean {
  return (
    recordedResources.some((resource) => isResourceOf(url.href, resource)) ||
    (unnamedResourceBase !== undefined && isUnderBase(unnamedResourceBase, url.href))
  );
}

export function mayCarryTo(bearer: Bearer, url: Readonly<URL>): boolean {
  return bearer.kind === 'key' || isCoveredBy(bearer.audience, url);
}
