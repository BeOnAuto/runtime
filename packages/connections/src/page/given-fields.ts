import { InvalidInput, Unavailable, type Conflict, type Issue } from '@on.auto/operations';
import { matchesKeyPattern } from '@on.auto/providers';
import { ClientIdSchema, type SecretKeepingFailure } from '@on.auto/tool-servers';
import { Result, Schema } from 'effect';

import { clientIdReadingIssuesOf, type EntryChecking } from '../entries/entry-checks.ts';
import { givenFieldsOf, wordsOfThePage, type Given } from '../entries/given-values.ts';
import {
  ChosenPlaybooksField,
  ConnectionIdField,
  NextClientIdField,
  TokenField,
} from '../operations/connection-fields.ts';
import { ChatField, ConnectionSchema, ModelField, type RecordedConnection } from '../registry/connection.ts';
import { connectedByConsent, takesNoCredential } from '../registry/link-decisions.ts';
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
  app_credentials: Schema.optionalKey(
    Schema.Record(Schema.String, GivenField).annotate({
      description:
        "For secret, the app credentials given beside the key, each a value under the name list_providers lists in the way's app_credentials; each is optional, and a name the way does not list here is refused",
    }),
  ),
  key_file: Schema.optionalKey(
    GivenField.annotate({
      description:
        "For jwt_bearer, the whole text of the key file the service gave, given alone. The runtime checks the key with the service before it keeps anything, then keeps the private key, sealed, and records the client's ID the file names. It keeps nothing else of the file.",
    }),
  ),
  playbooks: ChosenPlaybooksField,
  model: Schema.optionalKey(
    ModelField.annotate({
      description:
        'The id of the model Auto answers members with, as list_models writes it, given with the app credential that lets members write to Auto. Only an admin may give it.',
    }),
  ),
});

type Giving = typeof GivingSchema.Type;

const unmatchedMark = { pattern_unmatched: true } as const;

type FormatMark = Partial<typeof unmatchedMark>;

export const GivenConnectionSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  pattern_unmatched: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description:
        "Answered where the secret given does not match the pattern of a credential given by hand, which the runtime keeps all the same: the agent's pattern may be wrong as well as the key, for the page to ask the person to check that it is the key the instructions describe",
    }),
  ),
  chat: ChatField,
}).annotate({
  identifier: 'GivenConnection',
  description: 'The connection its credential was given to, and whether the secret given missed its pattern',
});

export const GivingTheClientSchema = Schema.Struct({
  id: ConnectionIdField,
  token: TokenField,
  client_id: ClientIdSchema.annotate({
    description:
      "The client ID of the organization's own OAuth client, as the provider issued it when the organization registered the client",
  }),
  client_secret: GivenField.annotate({ description: "The client secret of the organization's own OAuth client" }),
});

export const ClientGivenSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  next_client_id: NextClientIdField,
}).annotate({
  identifier: 'ClientGivenConnection',
  description:
    "The connection the organization's own OAuth client was given to, with its next client where it keeps one",
});

export function refused(issues: readonly Issue[]): InvalidInput {
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

export function clientUnkeptOf(name: string, { _tag, detail }: SecretKeepingFailure): InvalidInput | Unavailable {
  return _tag === 'secret_refused'
    ? new InvalidInput({
        detail: 'The client cannot be taken as it is given',
        issues: [{ pointer: '/client_secret', detail }],
      })
    : new Unavailable({ detail: unavailableWords.clientUnkept(name, detail) });
}

function withAReadableClientId(
  connection: RecordedConnection,
  given: Given,
  checking: EntryChecking,
): Result.Result<Given, InvalidInput> {
  const issues = given.clientId === undefined ? [] : clientIdReadingIssuesOf(connection, given.clientId, checking);
  return issues.length === 0 ? Result.succeed(given) : Result.fail(refused(issues));
}

const outOfItsFormat = "Paste the key itself: this value is not in the format of the provider's keys";

export const appCredentialOutOfItsFormat =
  "This value is not in the format this field takes. Copy it again from the provider's page and paste all of it.";

export const refusedByTheService =
  "The provider refused this key. Copy it again from the provider's page and paste all of it.";

export const notAKeyFile =
  'Auto cannot use this key file for this connection. Check that it is the JSON file that was downloaded when the key was created. If it is, remove the connection and add it again.';

export function keyRefusedWith(code: string): string {
  return `The provider did not accept this key. Check that each step on this page was done for this key and that the values you entered are right. A change at the provider can take a few minutes to apply. The provider answered: ${code}.`;
}

const keyFileAlone = 'Expected key_file alone, the key file of a credential of the kind jwt_bearer';

const keyFileOfAnotherKind: Issue = {
  pointer: '/key_file',
  detail: 'Expected no key_file: only a credential of the kind jwt_bearer takes a key file',
};

const besidesAKeyFile = ['value', 'client_id', 'client_secret', 'private_key', 'algorithm', 'app_credentials'] as const;

export function keyFileTextOf(giving: Omit<Giving, 'playbooks' | 'model'>): Result.Result<string, InvalidInput> {
  const { key_file: keyFile } = giving;
  return keyFile === undefined || besidesAKeyFile.some((field) => giving[field] !== undefined)
    ? Result.fail(refused([{ pointer: '', detail: keyFileAlone }]))
    : Result.succeed(keyFile);
}

export function formatMarkOf(
  { provider, credential: { pattern } }: RecordedConnection,
  { value }: Pick<Given, 'value'>,
): Result.Result<FormatMark, InvalidInput> {
  if (pattern === undefined || matchesKeyPattern(pattern, value)) {
    return Result.succeed({});
  }
  return provider === null
    ? Result.succeed(unmatchedMark)
    : Result.fail(refused([{ pointer: '/value', detail: outOfItsFormat }]));
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
  if (giving.key_file !== undefined) {
    return Result.fail(refused([keyFileOfAnotherKind]));
  }
  return Result.flatMap(Result.mapError(givenFieldsOf(credential, giving, wordsOfThePage), refused), (given) =>
    withAReadableClientId(connection, given, checking),
  );
}
