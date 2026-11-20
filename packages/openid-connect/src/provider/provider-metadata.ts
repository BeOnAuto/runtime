import { alternatives } from '@on.auto/phrasing';
import { Option, Result, Schema } from 'effect';
import type { ServerMetadata } from 'openid-client';

import { answerAt, type ProviderRequests } from './provider-requests.ts';
import type { EndpointsDeclared } from './sign-in-tokens.ts';

export const clientAuthenticationMethods = ['client_secret_basic', 'client_secret_post', 'client_secret_jwt'] as const;

export type ClientAuthenticationMethod = (typeof clientAuthenticationMethods)[number];

const methodWhereNoneIsDeclared: ClientAuthenticationMethod = 'client_secret_basic';

export interface ProviderMetadata {
  readonly server: ServerMetadata;
  readonly method: ClientAuthenticationMethod;
  readonly registrationEndpoint: string | undefined;
  readonly declares: EndpointsDeclared;
}

const MetadataDocument = Schema.Record(Schema.String, Schema.MutableJson);

const DeclaredMetadata = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.optionalKey(Schema.Unknown),
  token_endpoint: Schema.optionalKey(Schema.Unknown),
  jwks_uri: Schema.optionalKey(Schema.Unknown),
  token_endpoint_auth_methods_supported: Schema.optionalKey(Schema.Array(Schema.String)),
  registration_endpoint: Schema.optionalKey(Schema.Unknown),
  userinfo_endpoint: Schema.optionalKey(Schema.Unknown),
  revocation_endpoint: Schema.optionalKey(Schema.Unknown),
});

type Declared = typeof DeclaredMetadata.Type;

const decodeDocument = Schema.decodeUnknownOption(MetadataDocument);

const decodeDeclared = Schema.decodeUnknownOption(DeclaredMetadata);

const notFound = 404;

export function metadataAddressOf(issuer: string): string {
  return `${issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`;
}

export function authorizationServerMetadataAddressOf(issuer: string): string {
  const { origin, pathname } = new URL(issuer);
  return `${origin}/.well-known/oauth-authorization-server${pathname.replace(/\/$/u, '')}`;
}

function isAnHttpsUrl(address: unknown): address is string {
  return typeof address === 'string' && URL.parse(address)?.protocol === 'https:';
}

function httpsEndpointIn(declared: Pick<Declared, 'registration_endpoint'>): string | undefined {
  return isAnHttpsUrl(declared.registration_endpoint) ? declared.registration_endpoint : undefined;
}

function endpointRefusalOf(declared: Declared): string | undefined {
  const endpoints = [
    ['authorization_endpoint', declared.authorization_endpoint],
    ['token_endpoint', declared.token_endpoint],
    ['jwks_uri', declared.jwks_uri],
  ] as const;
  const missing = endpoints.find(([, address]) => !isAnHttpsUrl(address));
  return missing === undefined ? undefined : `names no ${missing[0]} that is an https URL`;
}

function methodOf(
  asked: ClientAuthenticationMethod | undefined,
  declared: readonly string[] = [methodWhereNoneIsDeclared],
): Result.Result<ClientAuthenticationMethod, string> {
  const chosen = asked ?? clientAuthenticationMethods.find((method) => declared.includes(method));
  if (chosen !== undefined && declared.includes(chosen)) {
    return Result.succeed(chosen);
  }
  const wanted = asked ?? alternatives(clientAuthenticationMethods);
  return Result.fail(`declares no ${wanted} among its token_endpoint_auth_methods_supported`);
}

function metadataIn(
  json: unknown,
  issuer: string,
  asked: ClientAuthenticationMethod | undefined,
): Result.Result<ProviderMetadata, string> {
  const [document, declared] = [decodeDocument(json), decodeDeclared(json)];
  if (Option.isNone(document) || Option.isNone(declared)) {
    return Result.fail('answers no metadata with an issuer');
  }
  if (declared.value.issuer !== issuer) {
    return Result.fail(`names the issuer ${declared.value.issuer}`);
  }
  const refusal = endpointRefusalOf(declared.value);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  return Result.map(methodOf(asked, declared.value.token_endpoint_auth_methods_supported), (method) => ({
    server: { ...document.value, issuer },
    method,
    registrationEndpoint: httpsEndpointIn(declared.value),
    declares: {
      userinfo: isAnHttpsUrl(declared.value.userinfo_endpoint),
      revocation: isAnHttpsUrl(declared.value.revocation_endpoint),
    },
  }));
}

function jsonIn(text: string): Result.Result<unknown, string> {
  return Result.try({ try: (): unknown => JSON.parse(text), catch: () => 'answers no JSON' });
}

type DocumentRead = Result.Result<unknown, string> | 'not_found';

async function documentAt(address: string, requests: ProviderRequests): Promise<DocumentRead> {
  const answer = await answerAt(requests, address, { headers: { accept: 'application/json' }, method: 'GET' });
  if (Result.isFailure(answer)) {
    return Result.fail(answer.failure);
  }
  const { ok, status } = answer.success;
  if (status === notFound) {
    return 'not_found';
  }
  return ok ? jsonIn(await answer.success.text()) : Result.fail(`answers ${status}`);
}

export async function providerMetadataOf(
  issuer: string,
  asked: ClientAuthenticationMethod | undefined,
  requests: ProviderRequests,
): Promise<Result.Result<ProviderMetadata, string>> {
  const address = metadataAddressOf(issuer);
  const document = await documentAt(address, requests);
  const found = document === 'not_found' ? Result.fail(`answers ${notFound}`) : document;
  const read = Result.flatMap(found, (json) => metadataIn(json, issuer, asked));
  return Result.mapError(read, (failure) => `${address} ${failure}`);
}

export type RegistrationEndpointRead = Result.Result<string, string> | 'not_declared';

function declaredOrNot(endpoint: string | undefined): RegistrationEndpointRead {
  return endpoint === undefined ? 'not_declared' : Result.succeed(endpoint);
}

function registrationEndpointIn(json: unknown, issuer: string): RegistrationEndpointRead {
  const declared = decodeDeclared(json);
  if (Option.isNone(declared)) {
    return Result.fail('answers no metadata with an issuer');
  }
  return declared.value.issuer === issuer
    ? declaredOrNot(httpsEndpointIn(declared.value))
    : Result.fail(`names the issuer ${declared.value.issuer}`);
}

export async function registrationEndpointOf(
  issuer: string,
  declaredBeside: string | undefined,
  requests: ProviderRequests,
): Promise<RegistrationEndpointRead> {
  if (declaredBeside !== undefined) {
    return Result.succeed(declaredBeside);
  }
  const address = authorizationServerMetadataAddressOf(issuer);
  const document = await documentAt(address, requests);
  if (document === 'not_found') {
    return 'not_declared';
  }
  const read = Result.isSuccess(document) ? registrationEndpointIn(document.success, issuer) : document;
  return read === 'not_declared' || Result.isSuccess(read) ? read : Result.fail(`${address} ${read.failure}`);
}
