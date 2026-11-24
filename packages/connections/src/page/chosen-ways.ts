import { InvalidInput, type Conflict, type Forbidden } from '@on.auto/operations';
import { isTheWayAsked, providerFoundBy } from '@on.auto/providers';
import { Effect, Option } from 'effect';

import { studioBaseFor } from '../links/connect-page.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { policyRefusalOf } from '../policy/policy-rules.ts';
import { providerCredentialChosen, valuesUnaskedBy, type ChosenCredential } from '../providers/chosen-provider-ways.ts';
import { providingOf } from '../providers/provider-providing.ts';
import type { KeptWithLink } from '../registry/registry-lookup.ts';
import { wayChosenOf, type WayAsked } from '../registry/way-decisions.ts';

export type WayChoosing = Pick<
  ConnectionServices,
  'providers' | 'providerValues' | 'policy' | 'consent' | 'pages' | 'secrets' | 'managedServiceAccounts'
>;

function handGivenCredentialOf(
  { connection, ways = [connection.credential] }: KeptWithLink,
  asked: WayAsked,
): Effect.Effect<ChosenCredential, InvalidInput> {
  const unasked = valuesUnaskedBy(asked.placeholders, []);
  if (unasked.length > 0) {
    return Effect.fail(
      new InvalidInput({ detail: `The connection ${connection.name} cannot connect this way.`, issues: unasked }),
    );
  }
  const way = ways.find((offered) => isTheWayAsked(offered, asked.credential));
  return Effect.succeed({ credential: Option.getOrThrow(Option.fromNullishOr(way)), says: {} });
}

function credentialOf(
  kept: KeptWithLink,
  asked: WayAsked,
  services: WayChoosing,
): Effect.Effect<ChosenCredential, InvalidInput> {
  const { connection } = kept;
  if (connection.provider === null) {
    return handGivenCredentialOf(kept, asked);
  }
  const named = Option.getOrThrow(Option.fromNullishOr(providerFoundBy(services.providers, connection.provider)));
  return Effect.flatMap(services.consent.hadSources(studioBaseFor(services.pages)), (consent) =>
    Effect.fromResult(providerCredentialChosen(named, connection, asked, { ...services, consent })),
  );
}

function refusedHere(kept: KeptWithLink, chosen: ChosenCredential, services: WayChoosing): Forbidden | undefined {
  const { provider, type, entry } = kept.connection;
  const addition = { provider, type, entry, credential: chosen.credential };
  return policyRefusalOf(services.policy, addition, providingOf(addition, services));
}

export function credentialChosenFor(
  kept: KeptWithLink,
  asked: WayAsked,
  services: WayChoosing,
): Effect.Effect<ChosenCredential, Conflict | InvalidInput | Forbidden> {
  return Effect.fromResult(wayChosenOf(kept, asked, services.providers)).pipe(
    Effect.andThen(() => credentialOf(kept, asked, services)),
    Effect.flatMap((chosen) => {
      const refusal = refusedHere(kept, chosen, services);
      return refusal === undefined ? Effect.succeed(chosen) : Effect.fail(refusal);
    }),
  );
}
