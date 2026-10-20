import { Schema } from 'effect';

type Json = Schema.Json;

type JsonFields = Readonly<Record<string, Json>>;

const AuthorizationServerSchema = Schema.Struct({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
});

export type AuthorizationServer = typeof AuthorizationServerSchema.Type;

const decodeAuthorizationServer = Schema.decodeUnknownSync(AuthorizationServerSchema);

export function authorizationServerOf(value: unknown): AuthorizationServer {
  return decodeAuthorizationServer(value);
}

export function rootRequirementOf(scheme: string): readonly JsonFields[] {
  return [{ [scheme]: [] }];
}

export function requirementsOf(scheme: string, scopes: readonly string[]): readonly JsonFields[] {
  return scopes.map((scope) => ({ [scheme]: [scope] }));
}

export function securitySchemesOf(scheme: string, server: AuthorizationServer, scopes: JsonFields): JsonFields {
  return {
    [scheme]: {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: server.authorization_endpoint,
          tokenUrl: server.token_endpoint,
          scopes,
        },
      },
    },
  };
}
