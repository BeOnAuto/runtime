import { Unavailable } from '@on.auto/operations';
import { providerNamed, type ProviderList } from '@on.auto/providers';
import {
  type GatewayEndAsked,
  type GatewayEndRefusal,
  type HadSources,
  type KeptRow,
  type WayGateway,
} from '@on.auto/tool-servers';
import { Effect, Function, Option, Result } from 'effect';

import type { ConnectionServices } from '../operations/connection-services.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import { declaredGatewayOf } from '../providers/provider-listing.ts';
import { connectsThroughItsGateway, type RecordedConnection } from '../registry/connection.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { gatewayWords, notReachedHereWords } from './consent-words.ts';

type Ending = Pick<ConnectionServices, 'secrets' | 'consent' | 'policy' | 'providers' | 'resolve'>;

type OfAProvider = Pick<RecordedConnection, 'provider' | 'credential'>;

type Sources = Pick<HadSources, 'sourceOf'>;

type Asked = Omit<GatewayEndAsked, 'key'>;

const unconfirmed = 'its gateway did not confirm it';

export function gatewayOf(connection: OfAProvider, providers: ProviderList): WayGateway | undefined {
  const { provider } = connection;
  if (provider === null || !connectsThroughItsGateway(connection)) {
    return undefined;
  }
  const named = Result.getOrUndefined(providerNamed(providers, provider));
  return named === undefined ? undefined : declaredGatewayOf(named);
}

export function throughItsGateway(gateway: WayGateway | undefined, { sourceOf }: Sources): Sources {
  return gateway === undefined
    ? { sourceOf: Function.constUndefined }
    : { sourceOf: (way) => sourceOf({ ...way, gateway }) };
}

function providerOf({ connection }: KeptConnection): string {
  return Option.getOrThrow(Option.fromNullishOr(connection.provider));
}

function unendedOf(kept: KeptConnection, refusal: GatewayEndRefusal): Unavailable {
  const { name } = kept.connection;
  if (refusal.refused === 'host') {
    return new Unavailable({ detail: gatewayWords.keyUnended(name, refusal.rule) });
  }
  return new Unavailable({
    detail:
      refusal.refused === 'no_client'
        ? gatewayWords.keyUnended(name, notReachedHereWords(providerOf(kept)))
        : gatewayWords.keyUnendedForNow(name, unconfirmed),
  });
}

function askedOf({ connection }: KeptConnection, services: Ending): Asked | undefined {
  const gateway = gatewayOf(connection, services.providers);
  return gateway === undefined
    ? undefined
    : {
        way: { issuer: String(connection.credential.issuer), gateway },
        reaches: reachesUnder(services.policy, services.resolve),
      };
}

function heldKeyOf(kept: KeptConnection, secretId: string, { secrets }: Ending) {
  const { name } = kept.connection;
  return secrets
    .read(secretId)
    .pipe(Effect.mapError(({ detail }) => new Unavailable({ detail: gatewayWords.keyUnread(name, detail) })));
}

function isHeldThroughAGateway(kept: KeptConnection): kept is KeptConnection & { readonly secretId: string } {
  return connectsThroughItsGateway(kept.connection) && kept.secretId !== undefined;
}

function endedBeforeRemoval(kept: KeptConnection, row: KeptRow, services: Ending): Effect.Effect<void, Unavailable> {
  const asked = askedOf(kept, services);
  if (asked === undefined) {
    return Effect.fail(
      new Unavailable({ detail: gatewayWords.keyUnended(kept.connection.name, gatewayWords.noGatewayNamed) }),
    );
  }
  return services.consent
    .end({ ...asked, key: row.value })
    .pipe(Effect.mapError((refusal) => unendedOf(kept, refusal)));
}

export function keyEndedBeforeRemoval(kept: KeptConnection, services: Ending): Effect.Effect<void, Unavailable> {
  if (!isHeldThroughAGateway(kept) || kept.connection.status === 'removed') {
    return Effect.void;
  }
  return Effect.flatMap(heldKeyOf(kept, kept.secretId, services), (row) =>
    row === undefined ? Effect.logError(gatewayWords.keyNoLongerHeld) : endedBeforeRemoval(kept, row, services),
  );
}

function triedToEndHeld(kept: KeptConnection & { readonly secretId: string }, unended: string, services: Ending) {
  return heldKeyOf(kept, kept.secretId, services).pipe(
    Effect.flatMap((row) => {
      const asked = askedOf(kept, services);
      return row === undefined || asked === undefined
        ? Effect.logError(unended)
        : services.consent.endTried({ ...asked, key: row.value }, unended);
    }),
    Effect.catch(() => Effect.logError(unended)),
  );
}

export function replacedKeyEndedOf(before: KeptConnection, services: Ending): Effect.Effect<void> {
  return isHeldThroughAGateway(before)
    ? Effect.andThen(
        triedToEndHeld(before, gatewayWords.oldKeyUnended, services),
        services.secrets.forget(before.secretId),
      )
    : Effect.void;
}

export function newerKeyEndedOf(found: KeptConnection, removed: KeptConnection, services: Ending): Effect.Effect<void> {
  return isHeldThroughAGateway(removed) && removed.secretId !== found.secretId
    ? triedToEndHeld(removed, gatewayWords.newerKeyUnended, services)
    : Effect.void;
}
