import type { FetchLike } from '@modelcontextprotocol/client';
import { Duration, Effect, Exit } from 'effect';

import { requestBoundsOf, type RequestBounds } from '../bounds/call-bounds.ts';
import type { ServiceClient } from '../consent/client-sources.ts';
import { consentServiceOf, type ConsentReturn, type ConsentServiceCalls } from './consent-service.ts';

export type ReturnKind = ConsentReturn['kind'] | 'elsewhere';

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
      readonly listing: ConsentServiceCalls['clients'];
    };

export type AutoOn = Extract<ThroughAuto, { readonly enabled: true }>;

export interface AutoAsking extends Partial<RequestBounds> {
  readonly fetch: FetchLike;
  readonly autoClients?: AutoClients;
}

const sourceOff: ThroughAuto = { enabled: false };

const listingBoundMs = 5000;

const listedFor = Duration.hours(1);

const heldAfterAFailure = Duration.minutes(5);

const noServiceClients: readonly ServiceClient[] = [];

export function unlistedWords(url: string): string {
  return `Auto's consent service at ${url} did not list the clients Auto has at authorization servers, so for five minutes no provider takes consent through Auto's clients here`;
}

export function throughAutoOf(asking: AutoAsking): ThroughAuto {
  const { autoClients, fetch } = asking;
  if (autoClients?.enabled !== true) {
    return sourceOff;
  }
  const { url } = autoClients.service;
  const bounds = requestBoundsOf(asking);
  const service = consentServiceOf({ fetch, url, ...bounds });
  const listing = consentServiceOf({ fetch, url, ...bounds, requestMs: Math.min(bounds.requestMs, listingBoundMs) });
  return { enabled: true, url, returnKindOf: autoClients.returnKindOf, service, listing: listing.clients };
}

export function autoOf({ client_source: source }: { readonly client_source: string }, through: ThroughAuto) {
  return source === 'auto' && through.enabled ? through : undefined;
}

export function servedKindOf(through: ThroughAuto, base: string): ConsentReturn['kind'] | undefined {
  if (!through.enabled) {
    return undefined;
  }
  const kind = through.returnKindOf(base);
  return kind === 'elsewhere' ? undefined : kind;
}

export function serviceClientsListed(through: ThroughAuto): Effect.Effect<readonly ServiceClient[]> {
  if (!through.enabled) {
    return Effect.succeed(noServiceClients);
  }
  const listing = through.listing.pipe(Effect.tapError(() => Effect.logWarning(unlistedWords(through.url))));
  const listed = Effect.runSync(
    Effect.cachedWithTTL(listing, Exit.match({ onSuccess: () => listedFor, onFailure: () => heldAfterAFailure })),
  );
  return Effect.orElseSucceed(listed, () => noServiceClients);
}

export function usableClientsOf(
  through: ThroughAuto,
  base: string,
  listed: Effect.Effect<readonly ServiceClient[]>,
): Effect.Effect<readonly ServiceClient[]> {
  return servedKindOf(through, base) === undefined ? Effect.succeed(noServiceClients) : listed;
}
