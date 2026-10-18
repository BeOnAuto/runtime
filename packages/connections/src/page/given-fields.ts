import { InvalidInput, type Conflict, type Issue } from '@on.auto/operations';
import { Result, Schema } from 'effect';

import { clientIdReadingIssuesOf, type EntryChecking } from '../entries/entry-checks.ts';
import { ConnectionIdField, TokenField } from '../operations/connection-fields.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import type { Credential } from '../registry/credential.ts';
import { takesNoCredential } from '../registry/registry-decisions.ts';

const GivenField = Schema.String.check(Schema.isMinLength(1));

export const GivingSchema = Schema.Struct({
  id: ConnectionIdField,
  token: TokenField,
  value: Schema.optionalKey(GivenField.annotate({ description: 'The secret, for a credential of the kind secret' })),
  client_id: Schema.optionalKey(
    GivenField.annotate({
      description: "The id of the client of client credentials, where the connection's credential holds none",
    }),
  ),
  client_secret: Schema.optionalKey(GivenField.annotate({ description: 'The client secret of client credentials' })),
  private_key: Schema.optionalKey(
    GivenField.annotate({
      description: 'The private key in PEM that signs the client assertion of client credentials',
    }),
  ),
  algorithm: Schema.optionalKey(
    Schema.String.annotate({ description: 'The signing algorithm of private_key, such as RS256 or ES256' }),
  ),
});

type Giving = typeof GivingSchema.Type;

interface Given {
  readonly pointer: string;
  readonly value: string;
  readonly endsWith?: string;
  readonly algorithm?: string;
  readonly clientId?: string;
}

const charactersShown = 4;

const fewestCharactersToShowAny = 12;

function shownEndingOf(value: string): { readonly endsWith?: string } {
  return value.length < fewestCharactersToShowAny ? {} : { endsWith: value.slice(-charactersShown) };
}

export function refused(issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: 'The credential cannot be taken as it is given', issues });
}

const valueAlone: Issue = {
  pointer: '',
  detail: 'Expected value alone, the secret of a credential of the kind secret',
};

function startsWithItsScheme(value: string, scheme: string | undefined): scheme is string {
  return scheme !== undefined && value.toLowerCase().startsWith(`${scheme.toLowerCase()} `);
}

function schemeWrittenAlready(scheme: string): Issue {
  return {
    pointer: '/value',
    detail: `Paste the token alone, without ${scheme} before it: the runtime writes ${scheme} itself`,
  };
}

function secretOf(giving: Giving, scheme: string | undefined): Result.Result<Given, InvalidInput> {
  const { value, client_id: clientId, client_secret: clientSecret, private_key: privateKey, algorithm } = giving;
  if (value === undefined || [clientId, clientSecret, privateKey, algorithm].some((field) => field !== undefined)) {
    return Result.fail(refused([valueAlone]));
  }
  return startsWithItsScheme(value, scheme)
    ? Result.fail(refused([schemeWrittenAlready(scheme)]))
    : Result.succeed({ pointer: '/value', value, ...shownEndingOf(value) });
}

function clientSecretOf(giving: Giving): Given | undefined {
  const { value, client_secret: clientSecret, private_key: privateKey, algorithm } = giving;
  if (value === undefined && clientSecret !== undefined && privateKey === undefined && algorithm === undefined) {
    return { pointer: '/client_secret', value: clientSecret, ...shownEndingOf(clientSecret) };
  }
  return value === undefined && clientSecret === undefined && privateKey !== undefined && algorithm !== undefined
    ? { pointer: '/private_key', value: privateKey, algorithm }
    : undefined;
}

const clientIdLacking: Issue = {
  pointer: '/client_id',
  detail:
    "Expected client_id: the connection's credential holds no client id, so it is given here with the secret or the key",
};

const clientIdHeldAlready: Issue = {
  pointer: '/client_id',
  detail: "Expected no client_id: the connection's credential holds its client id already",
};

function clientIdPresenceIssuesOf({ client_id: held }: Credential, { client_id: given }: Giving): readonly Issue[] {
  if (held === undefined && given === undefined) {
    return [clientIdLacking];
  }
  return held !== undefined && given !== undefined ? [clientIdHeldAlready] : [];
}

const neitherSecretNorKey: Issue = {
  pointer: '',
  detail: 'Expected client_secret, or private_key with its algorithm, one of the two',
};

function clientCredentialsOf(credential: Credential, giving: Giving): Result.Result<Given, InvalidInput> {
  const secret = clientSecretOf(giving);
  const clientIdIssues = clientIdPresenceIssuesOf(credential, giving);
  if (secret === undefined) {
    return Result.fail(refused([neitherSecretNorKey, ...clientIdIssues]));
  }
  if (clientIdIssues.length > 0) {
    return Result.fail(refused(clientIdIssues));
  }
  return Result.succeed(giving.client_id === undefined ? secret : { ...secret, clientId: giving.client_id });
}

function withAReadableClientId(
  connection: RecordedConnection,
  given: Given,
  checking: EntryChecking,
): Result.Result<Given, InvalidInput> {
  const issues = given.clientId === undefined ? [] : clientIdReadingIssuesOf(connection, given.clientId, checking);
  return issues.length === 0 ? Result.succeed(given) : Result.fail(refused(issues));
}

export function givenOf(
  connection: RecordedConnection,
  giving: Giving,
  checking: EntryChecking,
): Result.Result<Given, InvalidInput | Conflict> {
  const { name, credential } = connection;
  if (credential.kind === 'secret') {
    return secretOf(giving, credential.scheme);
  }
  return credential.kind === 'client_credentials'
    ? Result.flatMap(clientCredentialsOf(credential, giving), (given) =>
        withAReadableClientId(connection, given, checking),
      )
    : Result.fail(takesNoCredential(name));
}
