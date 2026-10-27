import { placeholdersIn, placeholdersReplaced } from '@on.auto/config';
import { Schema, type Redacted } from 'effect';

const clientSources = ['registered', 'auto', 'metadata_document', 'dynamic'] as const;

export const ClientSourceSchema = Schema.Literals(clientSources);

export type ClientSource = typeof ClientSourceSchema.Type;

export const wayClientSources = ['registered', 'metadata_document', 'dynamic'] as const;

export const WayClientSourceSchema = Schema.Literals(wayClientSources);

export type WayClientSource = typeof WayClientSourceSchema.Type;

export const ClientIdSchema = Schema.String.check(Schema.isMinLength(1));

const defaultClientSources: readonly WayClientSource[] = ['registered'];

export type RegisteredCredential =
  | { readonly kind: 'client_secret'; readonly clientSecret: Redacted.Redacted }
  | { readonly kind: 'private_key'; readonly privateKey: Redacted.Redacted; readonly algorithm: string }
  | { readonly kind: 'public' };

export type TokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'private_key_jwt' | 'none';

export interface RegisteredClient {
  readonly issuers: readonly string[];
  readonly clientId: string;
  readonly credential: RegisteredCredential;
  readonly tokenEndpointAuthMethod: TokenEndpointAuthMethod | null;
  readonly scopes?: readonly string[];
}

export const ServiceClientSchema = Schema.Struct({
  issuer: Schema.String,
  client_id: ClientIdSchema,
  scopes: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
});

export type ServiceClient = typeof ServiceClientSchema.Type;

export interface ClientsHad {
  readonly registeredClients: readonly RegisteredClient[];
  readonly publicUrl: string | undefined;
  readonly serviceClients: readonly ServiceClient[];
}

export interface WayOfClients {
  readonly issuer: string;
  readonly scope?: string | undefined;
  readonly clients?: readonly WayClientSource[] | undefined;
}

export interface HadSources {
  readonly sourcesOf: (way: WayOfClients) => readonly ClientSource[];
  readonly sourceOf: (way: WayOfClients) => ClientSource | undefined;
}

type ClientMetadata = Readonly<{
  client_name: string;
  redirect_uris: readonly string[];
  grant_types: readonly string[];
  response_types: readonly string[];
  application_type: string;
}>;

type ClientDocument = ClientMetadata & Readonly<{ client_id: string; token_endpoint_auth_method: 'none' }>;

export interface ClientMetadataDocument {
  readonly address: string;
  readonly document: ClientDocument;
}

const metadataDocumentPath = '/oauth/client.json';

const clientName = 'Auto Runtime';

const between = '\n';

const placedValue = '[^/?#]+';

function withoutTrailingSlash(issuer: string): string {
  return issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
}

export function isSameIssuer(one: string, other: string): boolean {
  return withoutTrailingSlash(one) === withoutTrailingSlash(other);
}

function shapeOf(template: string): RegExp {
  const fixed = placeholdersReplaced(withoutTrailingSlash(template), () => between).split(between);
  return new RegExp(`^${fixed.map((part) => RegExp.escape(part)).join(placedValue)}$`, 'u');
}

function isRegisteredAt(registered: string, issuer: string): boolean {
  return (
    isSameIssuer(registered, issuer) ||
    (placeholdersIn(registered).length > 0 && shapeOf(registered).test(withoutTrailingSlash(issuer)))
  );
}

function isRegisteredClientAt({ issuers }: RegisteredClient, issuer: string): boolean {
  return issuers.some((registered) => isRegisteredAt(registered, issuer));
}

function covers({ scopes }: { readonly scopes?: readonly string[] }, { scope }: WayOfClients): boolean {
  return scopes === undefined || (scope?.split(' ') ?? []).every((asked) => scopes.includes(asked));
}

export function registeredClientFor(
  clients: readonly RegisteredClient[],
  way: WayOfClients,
): RegisteredClient | undefined {
  return clients.find((client) => isRegisteredClientAt(client, way.issuer) && covers(client, way));
}

export function registeredClientNamed(
  clients: readonly RegisteredClient[],
  issuer: string,
  clientId: string,
): RegisteredClient | undefined {
  return clients.find((client) => client.clientId === clientId && isRegisteredClientAt(client, issuer));
}

export function serviceClientFor(clients: readonly ServiceClient[], way: WayOfClients): ServiceClient | undefined {
  return clients.find((client) => isRegisteredAt(client.issuer, way.issuer) && covers(client, way));
}

export function metadataDocumentOf(publicUrl: string | undefined): string | undefined {
  return publicUrl?.startsWith('https://') === true ? new URL(metadataDocumentPath, publicUrl).href : undefined;
}

function clientNameFor(server: string | null): string {
  return server === null ? clientName : `${clientName} for ${new URL(server).host}`;
}

export function clientMetadataOf(returnAddress: string, server: string | null = null): ClientMetadata {
  return {
    client_name: clientNameFor(server),
    redirect_uris: [returnAddress],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
  };
}

export function clientMetadataDocumentOf(
  publicUrl: string | undefined,
  returnAddress: string,
): ClientMetadataDocument | undefined {
  const address = metadataDocumentOf(publicUrl);
  return address === undefined
    ? undefined
    : {
        address,
        document: { client_id: address, ...clientMetadataOf(returnAddress), token_endpoint_auth_method: 'none' },
      };
}

function isHad(source: ClientSource, way: WayOfClients, had: ClientsHad): boolean {
  if (source === 'registered') {
    return registeredClientFor(had.registeredClients, way) !== undefined;
  }
  if (source === 'auto') {
    return serviceClientFor(had.serviceClients, way) !== undefined;
  }
  return source === 'dynamic' || metadataDocumentOf(had.publicUrl) !== undefined;
}

function clientSourcesOf({ clients }: WayOfClients): readonly ClientSource[] {
  const listed = clients ?? defaultClientSources;
  return listed.includes('registered') ? [...listed, 'auto'] : listed;
}

export function sourcesHad(way: WayOfClients, had: ClientsHad): readonly ClientSource[] {
  const listed = clientSourcesOf(way);
  return clientSources.filter((source) => listed.includes(source) && isHad(source, way, had));
}

export function sourceTakenOf(way: WayOfClients, had: ClientsHad): ClientSource | undefined {
  const [first] = sourcesHad(way, had);
  return first;
}

export function serviceClientTakenOf(way: WayOfClients, had: ClientsHad): ServiceClient | undefined {
  return sourceTakenOf(way, had) === 'auto' ? serviceClientFor(had.serviceClients, way) : undefined;
}
