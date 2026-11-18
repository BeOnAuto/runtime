import { randomUUID } from 'node:crypto';

import { Function, Schema } from 'effect';
import { decodeJwt, jwtVerify } from 'jose';

type Claims = Readonly<Record<string, unknown>>;

export const fakeClientId = 'auto-runtime';

export const fakeClientSecret = 'a-client-secret-of-the-test';

export interface ClientsAnswering {
  readonly registrationAnswer?: Claims;
  readonly registrationError?: string;
  readonly challengesTheClient?: boolean;
}

export interface FakeClients {
  readonly authenticated: (
    request: Readonly<Request>,
    form: Readonly<URLSearchParams>,
    audience: readonly string[],
  ) => Promise<string | undefined>;
  readonly refusedClient: () => Response;
  readonly registered: (request: Readonly<Request>) => Promise<Response>;
  readonly withdraw: (clientId: string) => void;
  readonly registrationsAsked: () => readonly Claims[];
}

function json(body: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

function basicCredentialsOf(request: Readonly<Request>): readonly string[] {
  const authorization = String(request.headers.get('authorization'));
  const decoded = Buffer.from(authorization.replace(/^Basic /u, ''), 'base64').toString('utf8');
  return decoded.split(':').map((part) => decodeURIComponent(part.replaceAll('+', ' ')));
}

function provenBy(secrets: ReadonlyMap<string, string>, assertion: string, audience: readonly string[]) {
  const clientId = String(decodeJwt(assertion).iss);
  const secret = new TextEncoder().encode(secrets.get(clientId) ?? '');
  return jwtVerify(assertion, secret, { issuer: clientId, audience: [...audience] }).then(
    (): string | undefined => clientId,
    Function.constUndefined,
  );
}

function givenIn(request: Readonly<Request>, form: Readonly<URLSearchParams>): readonly (string | null | undefined)[] {
  return form.has('client_secret') ? [form.get('client_id'), form.get('client_secret')] : basicCredentialsOf(request);
}

const claimsOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

function answerTo(asked: Claims, clientId: string, secret: string, overrides: Claims = {}): Claims {
  return {
    client_id: clientId,
    client_secret: secret,
    client_secret_expires_at: 0,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: asked['redirect_uris'],
    client_name: asked['client_name'],
    token_endpoint_auth_method: asked['token_endpoint_auth_method'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: asked['scope'],
    ...overrides,
  };
}

export function fakeClients(answering: ClientsAnswering): FakeClients {
  const secrets = new Map<string, string>([[fakeClientId, fakeClientSecret]]);
  const asked: Claims[] = [];
  return {
    authenticated: (request, form, audience) => {
      const assertion = form.get('client_assertion');
      if (assertion !== null) {
        return provenBy(secrets, assertion, audience);
      }
      const [clientId, secret] = givenIn(request, form);
      const known = clientId !== null && clientId !== undefined && secrets.get(clientId) === secret;
      return Promise.resolve(known ? clientId : undefined);
    },
    refusedClient: () =>
      answering.challengesTheClient === true
        ? json({ error: 'invalid_client' }, 401, { 'www-authenticate': 'Basic realm="token"' })
        : json({ error: 'invalid_client' }, 401),
    registered: async (request) => {
      const claims = claimsOf(await request.text());
      asked.push(claims);
      if (answering.registrationError !== undefined) {
        return json({ error: answering.registrationError, error_description: 'Refused by the test' }, 400);
      }
      const [clientId, secret] = [randomUUID(), randomUUID()];
      secrets.set(clientId, secret);
      return json(answerTo(claims, clientId, secret, answering.registrationAnswer), 201);
    },
    withdraw: (clientId) => {
      secrets.delete(clientId);
    },
    registrationsAsked: () => [...asked],
  };
}
