import type { FetchLike } from '@modelcontextprotocol/client';
import { Duration, Effect } from 'effect';

import { requestBoundsOf, type RequestBounds } from '../bounds/call-bounds.ts';
import type { ServiceClient } from '../consent/client-sources.ts';
import { consentServiceOf, type ConsentServiceCalls } from '../consent/consent-service.ts';

export type ReturnKind = 'hosted' | 'loopback' | 'elsewhere';

export interface AutoClients {
  readonly enabled: boolean;
  readonly service: { readonly url: string };
  readonly returnKindOf: (base: string) => ReturnKind;
}

export type ThroughAuto =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly url: string;
      readonly returnKindOf: (base: string) => ReturnKind;
      readonly service: ConsentServiceCalls;
    };

export type AutoOn = Extract<ThroughAuto, { readonly enabled: true }>;

export interface AutoAsking extends Partial<RequestBounds> {
  readonly fetch: FetchLike;
  readonly autoClients?: AutoClients;
}

const sourceOff: ThroughAuto = { enabled: false };

const listedFor = Duration.hours(1);

const noServiceClients: readonly ServiceClient[] = [];

export function unlistedWords(url: string): string {
  return `Auto's consent service at ${url} did not list the clients Auto has at authorization servers, so for an hour no provider takes consent through Auto's clients here`;
}

export function throughAutoOf(asking: AutoAsking): ThroughAuto {
  const { autoClients, fetch } = asking;
  if (autoClients?.enabled !== true) {
    return sourceOff;
  }
  const { url } = autoClients.service;
  const service = consentServiceOf({ fetch, url, ...requestBoundsOf(asking) });
  return { enabled: true, url, returnKindOf: autoClients.returnKindOf, service };
}

export function autoOf({ client_source: source }: { readonly client_source: string }, through: ThroughAuto) {
  return source === 'auto' && through.enabled ? through : undefined;
}

export function serviceClientsListed(through: ThroughAuto): Effect.Effect<readonly ServiceClient[]> {
  if (!through.enabled) {
    return Effect.succeed(noServiceClients);
  }
  const listing = through.service.clients.pipe(
    Effect.catch(() => Effect.as(Effect.logWarning(unlistedWords(through.url)), noServiceClients)),
  );
  return Effect.runSync(Effect.cachedWithTTL(listing, listedFor));
}
