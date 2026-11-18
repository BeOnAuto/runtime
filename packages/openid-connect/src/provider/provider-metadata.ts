import { alternatives } from '@on.auto/phrasing';
import { Option, Result, Schema } from 'effect';
import type { ServerMetadata } from 'openid-client';

import { answerAt, type ProviderRequests } from './provider-requests.ts';

export const clientAuthenticationMethods = ['client_secret_basic', 'client_secret_post', 'client_secret_jwt'] as const;

export type ClientAuthenticationMethod = (typeof clientAuthenticationMethods)[number];

const methodWhereNoneIsDeclared: ClientAuthenticationMethod = 'client_secret_basic';

interface ProviderMetadata {
  readonly server: ServerMetadata;
  readonly method: ClientAuthenticationMethod;
}

const MetadataDocument = Schema.Record(Schema.String, Schema.MutableJson);

const DeclaredMetadata = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.optionalKey(Schema.Unknown),
  token_endpoint: Schema.optionalKey(Schema.Unknown),
  jwks_uri: Schema.optionalKey(Schema.Unknown),
  token_endpoint_auth_methods_supported: Schema.optionalKey(Schema.Array(Schema.String)),
});

type Declared = typeof DeclaredMetadata.Type;

const decodeDocument = Schema.decodeUnknownOption(MetadataDocument);

const decodeDeclared = Schema.decodeUnknownOption(DeclaredMetadata);

export function metadataAddressOf(issuer: string): string {
  return `${issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`;
}

function isAnHttpsUrl(address: unknown): boolean {
  return typeof address === 'string' && URL.parse(address)?.protocol === 'https:';
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
  }));
}

function jsonIn(text: string): Result.Result<unknown, string> {
  return Result.try({ try: (): unknown => JSON.parse(text), catch: () => 'answers no JSON' });
}

async function documentAt(address: string, requests: ProviderRequests): Promise<Result.Result<unknown, string>> {
  const answer = await answerAt(requests, address, { headers: { accept: 'application/json' }, method: 'GET' });
  if (Result.isFailure(answer)) {
    return Result.fail(answer.failure);
  }
  return answer.success.ok ? jsonIn(await answer.success.text()) : Result.fail(`answers ${answer.success.status}`);
}

export async function providerMetadataOf(
  issuer: string,
  asked: ClientAuthenticationMethod | undefined,
  requests: ProviderRequests,
): Promise<Result.Result<ProviderMetadata, string>> {
  const address = metadataAddressOf(issuer);
  const read = Result.flatMap(await documentAt(address, requests), (json) => metadataIn(json, issuer, asked));
  return Result.mapError(read, (failure) => `${address} ${failure}`);
}
