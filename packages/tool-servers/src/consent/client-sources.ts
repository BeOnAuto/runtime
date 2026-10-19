import { placeholdersIn, placeholdersReplaced } from '@on.auto/config';
import { Schema, type Redacted } from 'effect';

export const clientSources = ['registered', 'metadata_document', 'dynamic'] as const;

export const ClientSourceSchema = Schema.Literals(clientSources);

export type ClientSource = typeof ClientSourceSchema.Type;

export const ClientIdSchema = Schema.String.check(Schema.isMinLength(1));

const defaultClientSources: readonly ClientSource[] = ['registered'];

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
}

export interface ClientsHad {
  readonly registeredClients: readonly RegisteredClient[];
  readonly publicUrl: string | undefined;
}

export interface WayOfClients {
  readonly issuer: string;
  readonly clients?: readonly ClientSource[] | undefined;
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

export function registeredClientAt(clients: readonly RegisteredClient[], issuer: string): RegisteredClient | undefined {
  return clients.find(({ issuers }) => issuers.some((registered) => isRegisteredAt(registered, issuer)));
}

export function metadataDocumentOf(publicUrl: string | undefined): string | undefined {
  return publicUrl?.startsWith('https://') === true ? new URL(metadataDocumentPath, publicUrl).href : undefined;
}

export function clientMetadataOf(returnAddress: string): ClientMetadata {
  return {
    client_name: clientName,
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

function isHad(source: ClientSource, { issuer }: WayOfClients, had: ClientsHad): boolean {
  if (source === 'registered') {
    return registeredClientAt(had.registeredClients, issuer) !== undefined;
  }
  return source === 'dynamic' || metadataDocumentOf(had.publicUrl) !== undefined;
}

function clientSourcesOf({ clients }: WayOfClients): readonly ClientSource[] {
  return clients ?? defaultClientSources;
}

export function sourcesHad(way: WayOfClients, had: ClientsHad): readonly ClientSource[] {
  const listed = clientSourcesOf(way);
  return clientSources.filter((source) => listed.includes(source) && isHad(source, way, had));
}
