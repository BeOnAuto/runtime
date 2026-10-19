import { selectClientAuthMethod, type ClientAuthMethod, type FetchLike } from '@modelcontextprotocol/client';
import { Effect } from 'effect';

import { libraryClientOf, type ActingClient, type ClientIdentity } from './acting-clients.ts';
import type { RevocationFailure } from './consent-client.ts';
import { refusalOf } from './consent-failures.ts';
import { libraryMetadataOf, type AuthorizationServer } from './server-metadata.ts';

interface RevokedTokens {
  readonly access_token: string;
  readonly refresh_token: string | undefined;
}

export interface Revoking {
  readonly server: AuthorizationServer;
  readonly client: ActingClient;
  readonly tokens: RevokedTokens;
  readonly fetch: FetchLike;
}

export type RevocationRefused = Extract<RevocationFailure, { readonly refused: 'not_revoked' | 'host' | 'unanswered' }>;

interface ClientAuthentication {
  readonly headers: Readonly<Record<string, string>>;
  readonly form: Readonly<Record<string, string>>;
}

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };

function methodOf({ server, client }: Revoking): ClientAuthMethod {
  const supported =
    server.revocation_endpoint_auth_methods_supported ?? server.token_endpoint_auth_methods_supported ?? [];
  return selectClientAuthMethod(libraryClientOf(client.identity), [...supported]);
}

function authenticationOf(method: ClientAuthMethod, { client_id: clientId, client_secret: secret }: ClientIdentity) {
  if (secret === undefined || method === 'none') {
    return { headers: {}, form: { client_id: clientId } };
  }
  return method === 'client_secret_basic'
    ? { headers: { authorization: `Basic ${btoa(`${clientId}:${secret}`)}` }, form: {} }
    : { headers: {}, form: { client_id: clientId, client_secret: secret } };
}

function tokenFormOf({ access_token: accessToken, refresh_token: refreshToken }: RevokedTokens) {
  return refreshToken === undefined
    ? { token: accessToken, token_type_hint: 'access_token' }
    : { token: refreshToken, token_type_hint: 'refresh_token' };
}

async function revocationRequestOf(revoking: Revoking, endpoint: string): Promise<RequestInit> {
  const { server, client, tokens } = revoking;
  const form = tokenFormOf(tokens);
  if (client.authentication === undefined) {
    const authentication: ClientAuthentication = authenticationOf(methodOf(revoking), client.identity);
    return {
      method: 'POST',
      headers: { ...formHeaders, ...authentication.headers },
      body: new URLSearchParams({ ...form, ...authentication.form }),
    };
  }
  const asserted = new URLSearchParams(form);
  await client.authentication(new Headers(formHeaders), asserted, endpoint, libraryMetadataOf(server));
  return { method: 'POST', headers: formHeaders, body: asserted };
}

export function revocationOf(revoking: Revoking): Effect.Effect<void, RevocationRefused> {
  const endpoint = revoking.server.revocation_endpoint;
  if (endpoint === undefined) {
    return Effect.void;
  }
  return Effect.tryPromise({
    try: async () => {
      const answer = await revoking.fetch(endpoint, await revocationRequestOf(revoking, endpoint));
      await answer.text();
      return answer.status;
    },
    catch: (error): RevocationRefused => refusalOf(error),
  }).pipe(
    Effect.flatMap((status) =>
      status >= 200 && status < 300 ? Effect.void : Effect.fail<RevocationRefused>({ refused: 'not_revoked', status }),
    ),
  );
}
