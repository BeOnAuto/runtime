import { Data, Predicate, Redacted, Result } from 'effect';

import { clientAuthenticationMethods, type ClientAuthenticationMethod } from './provider-metadata.ts';
import { answerAt, isAnErrorCode, type ProviderRequests } from './provider-requests.ts';

export interface RelyingPartyClient {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly tokenEndpointAuthMethod: ClientAuthenticationMethod;
}

export interface RegisteredClient extends RelyingPartyClient {
  readonly secretExpiresAt: number;
}

export type RegistrationRefusal =
  | { readonly notOffered: readonly string[] }
  | { readonly refused: string }
  | { readonly unreached: string }
  | { readonly unusable: string }
  | { readonly withoutScopes: readonly string[] };

export class ClientRegistrationError extends Data.TaggedError('ClientRegistrationError')<{
  readonly issuer: string;
  readonly redirectUri: string;
  readonly refusal: RegistrationRefusal;
  readonly message: string;
}> {}

export interface ClientRegistering {
  readonly issuer: string;
  readonly redirectUri: string;
  readonly endpoint: string;
  readonly scopes: readonly string[];
  readonly tokenEndpointAuthMethod: ClientAuthenticationMethod;
  readonly clientName: string;
}

const secretThatNeverEnds = 0;

const methodWhereNoneIsAnswered: ClientAuthenticationMethod = 'client_secret_basic';

function wordsOf({ issuer }: Pick<ClientRegistering, 'issuer'>, refusal: RegistrationRefusal): string {
  if ('notOffered' in refusal) {
    return `The identity provider at ${issuer} declares no registration_endpoint at ${refusal.notOffered.join(' or ')}`;
  }
  if ('refused' in refusal) {
    return `The identity provider at ${issuer} refused to register a client: ${refusal.refused}`;
  }
  if ('unreached' in refusal) {
    return `The registration endpoint of the identity provider at ${issuer} ${refusal.unreached}`;
  }
  return 'unusable' in refusal
    ? `The identity provider at ${issuer} registered a client that cannot sign people in: ${refusal.unusable}`
    : `The identity provider at ${issuer} registered a client without the scopes ${refusal.withoutScopes.join(' ')}`;
}

export function clientRegistrationError(
  registering: Pick<ClientRegistering, 'issuer' | 'redirectUri'>,
  refusal: RegistrationRefusal,
): ClientRegistrationError {
  const { issuer, redirectUri } = registering;
  return new ClientRegistrationError({ issuer, redirectUri, refusal, message: wordsOf(registering, refusal) });
}

function requestOf({ redirectUri, scopes, tokenEndpointAuthMethod, clientName }: ClientRegistering): string {
  return JSON.stringify({
    redirect_uris: [redirectUri],
    client_name: clientName,
    response_types: ['code'],
    grant_types: ['authorization_code'],
    application_type: 'web',
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    scope: scopes.join(' '),
  });
}

function textOf(fields: object, name: string): string | undefined {
  const value: unknown = Reflect.get(fields, name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isAMethodSpoken(method: unknown): method is ClientAuthenticationMethod {
  return clientAuthenticationMethods.some((spoken) => spoken === method);
}

function methodIn(fields: object): ClientAuthenticationMethod | undefined {
  const answered: unknown = Reflect.get(fields, 'token_endpoint_auth_method') ?? methodWhereNoneIsAnswered;
  return isAMethodSpoken(answered) ? answered : undefined;
}

export function isLastingAt({ secretExpiresAt }: Pick<RegisteredClient, 'secretExpiresAt'>, nowMs: number): boolean {
  return secretExpiresAt === secretThatNeverEnds || secretExpiresAt * 1000 > nowMs;
}

function endOf(fields: object, nowMs: number): number | undefined {
  const answered: unknown = Reflect.get(fields, 'client_secret_expires_at') ?? secretThatNeverEnds;
  return Number.isSafeInteger(answered) && isLastingAt({ secretExpiresAt: Number(answered) }, nowMs)
    ? Number(answered)
    : undefined;
}

function holdsTheRedirectUri(fields: object, redirectUri: string): boolean {
  const answered: unknown = Reflect.get(fields, 'redirect_uris');
  return Array.isArray(answered) && answered.includes(redirectUri);
}

function scopesMissingFrom(fields: object, asked: readonly string[]): readonly string[] {
  const answered: unknown = Reflect.get(fields, 'scope');
  const granted = typeof answered === 'string' ? answered.split(' ') : asked;
  return asked.filter((scope) => !granted.includes(scope));
}

function usableIn(
  fields: object,
  { redirectUri }: ClientRegistering,
  nowMs: number,
): Result.Result<RegisteredClient, string> {
  const [clientId, clientSecret] = [textOf(fields, 'client_id'), textOf(fields, 'client_secret')];
  if (clientId === undefined || clientSecret === undefined) {
    return Result.fail(`it answered no ${clientId === undefined ? 'client_id' : 'client_secret'}`);
  }
  if (!holdsTheRedirectUri(fields, redirectUri)) {
    return Result.fail(`its redirect_uris leave out ${redirectUri}`);
  }
  const tokenEndpointAuthMethod = methodIn(fields);
  if (tokenEndpointAuthMethod === undefined) {
    return Result.fail(
      'its token_endpoint_auth_method is not client_secret_basic, client_secret_post or client_secret_jwt',
    );
  }
  const secretExpiresAt = endOf(fields, nowMs);
  return secretExpiresAt === undefined
    ? Result.fail('its client_secret_expires_at is neither 0 nor a time in the future')
    : Result.succeed({ clientId, clientSecret: Redacted.make(clientSecret), tokenEndpointAuthMethod, secretExpiresAt });
}

function clientIn(
  fields: object,
  registering: ClientRegistering,
  nowMs: number,
): Result.Result<RegisteredClient, RegistrationRefusal> {
  const usable = usableIn(fields, registering, nowMs);
  if (Result.isFailure(usable)) {
    return Result.fail({ unusable: usable.failure });
  }
  const withoutScopes = scopesMissingFrom(fields, registering.scopes);
  return withoutScopes.length > 0 ? Result.fail({ withoutScopes }) : Result.succeed(usable.success);
}

function jsonObjectIn(text: string): object | undefined {
  const parsed = Result.try((): unknown => JSON.parse(text));
  return Result.isSuccess(parsed) && Predicate.isObject(parsed.success) && !Array.isArray(parsed.success)
    ? parsed.success
    : undefined;
}

function refusalOf(status: number, body: object | undefined): RegistrationRefusal {
  const code = body === undefined ? undefined : textOf(body, 'error');
  return { refused: code !== undefined && isAnErrorCode(code) ? code : `it answered ${status}` };
}

async function answeredFields(
  registering: ClientRegistering,
  requests: ProviderRequests,
): Promise<Result.Result<object, RegistrationRefusal>> {
  const answer = await answerAt(requests, registering.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: requestOf(registering),
  });
  if (Result.isFailure(answer)) {
    return Result.fail({ unreached: answer.failure });
  }
  const fields = jsonObjectIn(await answer.success.text());
  if (!answer.success.ok) {
    return Result.fail(refusalOf(answer.success.status, fields));
  }
  return fields === undefined ? Result.fail({ unusable: 'it answered no JSON object' }) : Result.succeed(fields);
}

export async function clientRegisteredAt(
  registering: ClientRegistering,
  requests: ProviderRequests,
  nowMs: number = Date.now(),
): Promise<RegisteredClient> {
  const fields = await answeredFields(registering, requests);
  const registered = Result.flatMap(fields, (answered) => clientIn(answered, registering, nowMs));
  if (Result.isFailure(registered)) {
    throw clientRegistrationError(registering, registered.failure);
  }
  return registered.success;
}
