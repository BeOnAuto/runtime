import { isJsonPointer, TokenRequestSchema, tokenRequestIssuesOf, type TokenRequest } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const notAPointer = 'Expected a JSON Pointer into the key file, such as /private_key';

const PointerSchema = Schema.String.check(
  Schema.makeFilter((pointer: string) => (isJsonPointer(pointer) ? undefined : notAPointer)),
);

const JsonKeyFileSchema = Schema.Struct({
  format: Schema.optionalKey(
    Schema.Literal('json').annotate({
      description: "json, the default, where the key file is a JSON object that holds the client's ID and the key",
    }),
  ),
  client_id: PointerSchema.annotate({
    description: "The JSON Pointer to the client's ID in the key file, which the assertion names as its issuer",
  }),
  private_key: PointerSchema.annotate({
    description: 'The JSON Pointer to the private key in the key file, in PEM, which signs the assertion',
  }),
}).annotate({
  description:
    "For jwt_bearer, where the two values sit in the key file the service gives, each as a JSON Pointer. Auto keeps the private key, sealed, and records the client's ID; it keeps nothing else of the file",
});

const PemKeyFileSchema = Schema.Struct({
  format: Schema.Literal('pem').annotate({
    description:
      "For jwt_bearer, pem where the key file is the private key itself in PEM. The client's ID then comes from client_id",
  }),
}).annotate({
  description:
    'For jwt_bearer, a key file that is the private key itself in PEM, in PKCS #1 or PKCS #8. Auto keeps the private key, sealed',
});

const KeyFileSchema = Schema.Union([JsonKeyFileSchema, PemKeyFileSchema]);

export const assertionFields = {
  subject: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        'For jwt_bearer, the account the token is asked for, such as a mailbox, each {name} in it a placeholder of the way or of the provider. Leave it out where the service account acts as itself: Auto then asks for a token for the service account, and the JWT names no subject',
    }),
  ),
  key_file: Schema.optionalKey(KeyFileSchema),
  client_id: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "For jwt_bearer with a key file in PEM, the client's ID the assertion names as its issuer, which may hold one of this way's placeholders",
    }),
  ),
  token_request: Schema.optionalKey(
    TokenRequestSchema.annotate({
      description:
        'For jwt_bearer, the request that asks the service for a token, for a service that has its own: its method and its https URL under the issuer, sent with the signed assertion as its Bearer. In issued, the JSON Pointers to the token and to the time it ends in the answer',
    }),
  ),
};

export const assertionFieldNames = ['subject', 'key_file', 'client_id', 'token_request'] as const;

interface AssertingWay {
  readonly kind: string;
  readonly issuer?: string | undefined;
  readonly scope?: string | undefined;
  readonly subject?: string | undefined;
  readonly key_file?: typeof KeyFileSchema.Type | undefined;
  readonly client_id?: string | undefined;
  readonly token_request?: TokenRequest | undefined;
}

interface WayIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

const clientNamedByThePem =
  "Expected client_id, which a jwt_bearer way whose key file is in PEM takes, since such a file names no client's ID";

const clientNamedByTheFile = "Expected no client_id: the key file names the client's ID at its client_id pointer";

const namedByTheRequest =
  'Expected no subject or scope beside token_request, whose assertion names the client alone and carries no scope';

function clientIdIssuesOf({ key_file: keyFile, client_id: clientId }: AssertingWay): readonly WayIssue[] {
  if (keyFile === undefined) {
    return [];
  }
  if (keyFile.format === 'pem') {
    return clientId === undefined ? [{ path: ['client_id'], issue: clientNamedByThePem }] : [];
  }
  return clientId === undefined ? [] : [{ path: ['client_id'], issue: clientNamedByTheFile }];
}

function requestIssuesOf({ token_request: request, issuer, subject, scope }: AssertingWay): readonly WayIssue[] {
  if (request === undefined) {
    return [];
  }
  const given = { subject, scope };
  const named = (['subject', 'scope'] as const)
    .filter((field) => given[field] !== undefined)
    .map((field) => ({ path: [field], issue: namedByTheRequest }));
  const sent = issuer === undefined ? [] : tokenRequestIssuesOf(issuer, request);
  return [...named, ...sent.map(({ path, issue }) => ({ path: ['token_request', ...path], issue }))];
}

export function assertionIssuesOf(way: AssertingWay): readonly WayIssue[] {
  return way.kind === 'jwt_bearer' ? [...clientIdIssuesOf(way), ...requestIssuesOf(way)] : [];
}
