import type {
  ClientSource,
  HadSources,
  PermissionsStated,
  WayClientSource,
  WayGateway,
  WayOfClients,
  WayPkce,
} from '@on.auto/tool-servers';

import { notReachedHereWords } from '../page/consent-words.ts';

interface WayOfConsent {
  readonly kind?: string;
  readonly issuer?: string;
  readonly scope?: string;
  readonly clients?: readonly WayClientSource[];
  readonly pkce?: WayPkce;
  readonly gateway?: WayGateway;
  readonly installation?: unknown;
  readonly permissions?: PermissionsStated;
  readonly oauth_client?: string;
}

export function takesTheRuntimesOwnClientAlone({ gateway, installation }: WayOfConsent): boolean {
  return gateway !== undefined || installation !== undefined;
}

export function takesAClientForTheApp({
  kind,
  permissions,
  gateway,
  oauth_client: oauthClient,
}: WayOfConsent): boolean {
  return (
    kind === 'authorization' && permissions === 'application' && gateway === undefined && oauthClient === undefined
  );
}

/**
 * How a way of consent is offered here: the source of the client a start takes, with `awaiting_approval` where that
 * client is one of Auto's that its vendor has not yet approved, as Auto's consent service lists it; or why it is not.
 */
export type ConsentOffered =
  | { readonly client_source: ClientSource; readonly awaiting_approval?: true }
  | { readonly because: string };

function throughARegisteredClient(provider: string): string {
  return `The provider ${provider} takes consent through a client whoever runs Auto registers`;
}

function wayOfClientsOf({
  issuer,
  scope,
  clients,
  pkce,
  gateway,
  installation,
  permissions,
}: WayOfConsent): WayOfClients {
  return {
    issuer: String(issuer),
    scope,
    clients,
    pkce,
    permissions,
    ...(gateway === undefined ? {} : { gateway: { url: gateway.url } }),
    ...(installation === undefined ? {} : { installs: true }),
  };
}

function scopelessOf({ scope: _scope, ...way }: WayOfConsent): WayOfConsent {
  return way;
}

function unsetUpWordsOf(provider: string, way: WayOfConsent, consent: HadSources): string {
  if (way.gateway !== undefined) {
    return notReachedHereWords(provider);
  }
  return consent.sourcesOf(wayOfClientsOf(scopelessOf(way))).length === 0
    ? `${throughARegisteredClient(provider)}, which is not set up here`
    : `${throughARegisteredClient(provider)}, and no client set up here covers every scope its way asks, ${String(way.scope)}`;
}

/**
 * Whether a way connects through a client of Auto's that its vendor has not yet approved, as the listing marks it with
 * `awaiting_approval`: a way of consent whose start takes a client here, which is every way of consent but one under
 * the organization's own OAuth client, and whose client Auto's consent service lists as awaiting it. A fact of the
 * client, never of the provider's name.
 */
export function awaitsApprovalHere(provider: string, way: WayOfConsent, consent: HadSources): boolean {
  const takesAClientHere =
    way.kind === 'authorization' && (takesTheRuntimesOwnClientAlone(way) || way.oauth_client === undefined);
  return takesAClientHere && 'awaiting_approval' in consentOfferedOf(provider, way, consent);
}

export function consentOfferedOf(provider: string, way: WayOfConsent, consent: HadSources): ConsentOffered {
  const ofClients = wayOfClientsOf(way);
  const source = consent.sourceOf(ofClients);
  if (source === undefined) {
    return { because: unsetUpWordsOf(provider, way, consent) };
  }
  return consent.awaitsApproval(ofClients)
    ? { client_source: source, awaiting_approval: true }
    : { client_source: source };
}
