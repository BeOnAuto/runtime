import { InvalidInput, Unavailable, type Conflict, type Issue } from '@on.auto/operations';
import type { SecretKeepingFailure } from '@on.auto/tool-servers';
import { Result, Schema } from 'effect';

import { clientIdReadingIssuesOf, type EntryChecking } from '../entries/entry-checks.ts';
import { givenFieldsOf, wordsOfThePage, type Given } from '../entries/given-values.ts';
import { ConnectionIdField, TokenField } from '../operations/connection-fields.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { connectedByConsent, takesNoCredential } from '../registry/registry-decisions.ts';
import { unavailableWords } from './consent-words.ts';

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

function refused(issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: 'The credential cannot be taken as it is given', issues });
}

export function unkeptRefusalOf(
  name: string,
  pointer: string,
  { _tag, detail }: SecretKeepingFailure,
): InvalidInput | Unavailable {
  return _tag === 'secret_refused'
    ? refused([{ pointer, detail }])
    : new Unavailable({ detail: unavailableWords.credentialUnkept(name, detail) });
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
  if (credential.kind === 'authorization') {
    return Result.fail(connectedByConsent(name));
  }
  if (credential.kind !== 'secret' && credential.kind !== 'client_credentials') {
    return Result.fail(takesNoCredential(name));
  }
  return Result.flatMap(Result.mapError(givenFieldsOf(credential, giving, wordsOfThePage), refused), (given) =>
    withAReadableClientId(connection, given, checking),
  );
}
