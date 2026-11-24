import {
  Caller,
  defineHttpOperation,
  mayCall,
  roleRefusalDetail,
  type CallerIdentity,
  type Runnable,
  type Unavailable,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { returnAddressOf, studioBaseFor } from '../links/connect-page.ts';
import { chatAnsweringOf, chatHostingOf, type Chatting } from '../operations/connection-chat.ts';
import { opensSockets } from '../operations/connection-services.ts';
import { isStartRuledFor, type StartsOfConnections } from '../policy/connection-starts.ts';
import { adderRefusalOf, approvingAskedOf } from '../policy/policy-rules.ts';
import { ProvidersSchema, type ListedProvider } from './listed-providers.ts';
import { chatOfferedOn, listedProviders } from './provider-listing.ts';
import { addingRefusedTo, type OfferingServices } from './provider-offering.ts';

type Reconnecting = Pick<ListedProvider, 'may_reconnect' | 'reconnect_refusal'>;

type ListingServices = OfferingServices & StartsOfConnections;

const reconnectingAllowed: Reconnecting = { may_reconnect: true };

const reconnectingRefused: Reconnecting = { may_reconnect: false, reconnect_refusal: roleRefusalDetail };

function mayReconnect(
  { access }: ListingServices,
  reconnecting: Runnable<'org'>,
  caller: CallerIdentity,
): Effect.Effect<boolean, Unavailable> {
  return adderRefusalOf(access, caller) === undefined
    ? mayCall({ operation: reconnecting, caller, org: caller.org })
    : Effect.succeed(false);
}

interface Listed {
  readonly providers: readonly ListedProvider[];
  readonly reconnecting: Runnable<'org'>;
  readonly caller: CallerIdentity;
}

function withWhoReconnects(
  listing: ListingServices,
  { providers, reconnecting, caller }: Listed,
): Effect.Effect<readonly ListedProvider[], Unavailable> {
  const asksWhoReconnects = ({ name, replaces }: ListedProvider): boolean =>
    replaces !== undefined && isStartRuledFor(listing, name);
  if (!providers.some((provider) => asksWhoReconnects(provider))) {
    return Effect.succeed(providers);
  }
  return Effect.map(mayReconnect(listing, reconnecting, caller), (may) => {
    const said = may ? reconnectingAllowed : reconnectingRefused;
    return providers.map((provider) => (asksWhoReconnects(provider) ? { ...provider, ...said } : provider));
  });
}

interface Asked {
  readonly adding: Runnable<'org'>;
  readonly approving: Runnable<'org'>;
  readonly reconnecting: Runnable<'org'>;
  readonly chatting: Chatting | undefined;
}

const chatsListedOf = Effect.fnUntraced(function* (listing: OfferingServices, chatting: Chatting | undefined) {
  if (chatting === undefined) {
    return {};
  }
  const hosting = chatHostingOf(listing, chatting);
  const offered = listing.providers.providers.flatMap((provider) =>
    provider.entry.credentials.map((way) => chatOfferedOn(provider, way, hosting)),
  );
  const answering = yield* chatAnsweringOf(offered, chatting);
  return { chats: { throughAGateway: hosting.throughAGateway, answering } };
});

export function defineListProviders(listing: ListingServices, { adding, approving, reconnecting, chatting }: Asked) {
  return defineHttpOperation('org', 'query', {
    name: 'list_providers',
    title: 'List providers',
    description: [
      'Lists the providers a person may connect here, by name, each with the ways a credential reaches its server and the values a connection to it takes.',
      'Use it to show a person what they can connect; add_connection connects one by its name.',
      '`may_add` says whether this caller may add a connection, and `refusal` why not.',
      '`may_connect` says whether this caller may also approve the connection it adds.',
      "`return_address` is the redirect URI the organization's own OAuth client registers at a provider before a person connects under it.",
    ].join(' '),
    route: { method: 'GET', path: '/providers' },
    body: { kind: 'none' },
    inputSchema: Schema.Record(Schema.String, Schema.Never),
    outputSchema: ProvidersSchema,
    reasons: ['unavailable'],
    handle: Effect.fnUntraced(function* () {
      const caller = yield* Caller;
      const refusal = yield* addingRefusedTo(listing, adding, caller);
      const mayApprove = yield* mayCall(approvingAskedOf(approving, caller));
      const consent = yield* listing.consent.hadSources(studioBaseFor(listing.pages));
      const chats = yield* chatsListedOf(listing, chatting);
      return {
        providers: yield* withWhoReconnects(listing, {
          providers: listedProviders({ ...listing, consent, opensSockets: opensSockets(listing), ...chats }),
          reconnecting,
          caller,
        }),
        may_add: refusal === null,
        may_connect: refusal === null && mayApprove,
        refusal,
        return_address: returnAddressOf(listing.pages),
      };
    }),
  });
}
