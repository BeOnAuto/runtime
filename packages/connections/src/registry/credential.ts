import { articled, listed } from '@on.auto/phrasing';
import {
  consentEndpoints,
  consentIssuesOf,
  InstallationSchema,
  keyFieldNames,
  keyFields,
  wayAddresses,
  wayFields,
  type WayAddress,
} from '@on.auto/providers';
import {
  ClientIdSchema,
  ClientSourceSchema,
  headerNamePattern,
  isPinnableUrl,
  pinnedUrlShape,
  TokenRequestSchema,
} from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { nameIssuesOf, variableIssuesOf } from './credential-places.ts';
import {
  credentialThroughAGateway,
  fieldsThroughAGateway,
  gatewayPlacementIssuesOf,
  isThroughAGateway,
} from './gateway-credentials.ts';

const credentialKinds = ['none', 'reference', 'secret', 'client_credentials', 'authorization', 'jwt_bearer'] as const;

export const CredentialKindSchema = Schema.Literals(credentialKinds);

export type CredentialKind = typeof CredentialKindSchema.Type;

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

export const CredentialFieldsSchema = Schema.Struct({
  kind: CredentialKindSchema,
  variable: Schema.optionalKey(
    NamedSchema.annotate({
      description:
        'For reference, the variable of the runtime that holds the value, one that connections.variables lists',
    }),
  ),
  name: Schema.optionalKey(
    wayFields.name.annotate({
      description: 'For secret and reference, the header, query parameter or security scheme the value is sent as',
    }),
  ),
  in: Schema.optionalKey(
    wayFields.in.annotate({
      description:
        'For secret and reference, what name is: header, or for an HTTP API query, a query parameter, or security, a security scheme of its document',
    }),
  ),
  scheme: Schema.optionalKey(
    wayFields.scheme.annotate({
      description: 'For a header, the scheme written before the value, such as Bearer',
    }),
  ),
  issuer: Schema.optionalKey(
    wayFields.issuer.annotate({
      description: 'For client_credentials, authorization and jwt_bearer, the https URL of the authorization server',
    }),
  ),
  client_id: Schema.optionalKey(
    ClientIdSchema.annotate({
      description:
        "For client_credentials, the id of the client, else given on the page; for authorization, the id of the client the connection was made with, once connected, or under the organization's own OAuth client its client ID once the person gives it on the page; for jwt_bearer, the id of the client in the key file the person gives on the page, once connected, or for a key file in PEM the one given with the way's values",
    }),
  ),
  scope: Schema.optionalKey(
    wayFields.scope.annotate({
      description:
        'For client_credentials, authorization and jwt_bearer, the scopes asked, separated by spaces, none when left out',
    }),
  ),
  subject: Schema.optionalKey(
    NamedSchema.annotate({
      description: 'For jwt_bearer, the account the token is asked for, such as the mailbox the connection works in',
    }),
  ),
  parameters: Schema.optionalKey(
    wayFields.parameters.annotate({
      description:
        'For authorization, the parameters its authorization request carries beside the standard ones; for client_credentials, those its token request carries, a grant_type among them in place of client_credentials',
    }),
  ),
  token_request: Schema.optionalKey(
    TokenRequestSchema.annotate({
      description:
        "For jwt_bearer, the request that asks the service for a token, where the service has its own: its method and its https URL under the issuer, with the way's values in it, sent with the signed assertion as its Bearer, and where the answer names the token and the time it ends",
    }),
  ),
  installation: Schema.optionalKey(
    InstallationSchema.annotate({
      description:
        'For authorization with application permissions, how the connection is made by installing the application whoever runs Auto registered, and how each of its tokens is asked for the installation it uses',
    }),
  ),
  authorization_endpoint: Schema.optionalKey(
    wayFields.authorization_endpoint.annotate({
      description: 'For authorization, the authorization endpoint, where the server publishes no metadata',
    }),
  ),
  token_endpoint: Schema.optionalKey(
    wayFields.token_endpoint.annotate({
      description: 'For authorization, the token endpoint, beside the authorization endpoint',
    }),
  ),
  revocation_endpoint: Schema.optionalKey(
    wayFields.revocation_endpoint.annotate({
      description: 'For authorization, the revocation endpoint, beside them where the server has one',
    }),
  ),
  pkce: Schema.optionalKey(
    wayFields.pkce.annotate({
      description:
        'For authorization, none where the server, its endpoints written out, takes no PKCE challenge, so a registered client that authenticates redeems the code without a verifier',
    }),
  ),
  clients: Schema.optionalKey(
    wayFields.clients.annotate({
      description:
        'For authorization, the client sources its server takes, in the order the runtime takes them; registered when left out',
    }),
  ),
  client_source: Schema.optionalKey(
    ClientSourceSchema.annotate({
      description:
        "For authorization, the source of the client the connection was made with, once connected; own from the start where it runs under the organization's own OAuth client, whose client ID and client secret the person gives on the page",
    }),
  ),
  instructions: Schema.optionalKey(
    keyFields.instructions(
      'For secret, how the person makes the key, which the page shows them, in Markdown without HTML of at most 1,000 characters: where it is made, with a link to that page, the plan or role it needs, the permissions it needs and its format',
    ),
  ),
  key_page: Schema.optionalKey(
    keyFields.key_page('For secret, the https address of the page where the person makes the key'),
  ),
  example: Schema.optionalKey(
    keyFields.example(
      'For secret, what the key looks like, with an ellipsis in place of its characters, such as ghp_…, which the field of the key shows',
    ),
  ),
  pattern: Schema.optionalKey(
    keyFields.pattern(
      "For secret, the regular expression from ^ to $ the key matches, of at most 200 characters: a provider's refuses a value of another format, and one given by hand answers it with pattern_unmatched",
    ),
  ),
});

type CredentialFields = typeof CredentialFieldsSchema.Type;

type Field = Exclude<keyof CredentialFields, 'kind'>;

type Placement = NonNullable<CredentialFields['in']>;

const everyFieldButTheScheme: readonly Exclude<Field, 'scheme'>[] = [
  'variable',
  'name',
  'in',
  'issuer',
  'client_id',
  'scope',
  'subject',
  'parameters',
  'token_request',
  'installation',
  ...consentEndpoints,
  'pkce',
  'clients',
  'client_source',
  ...keyFieldNames,
];

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
  readonly recorded?: readonly Field[];
}

const fieldsOfEachKind: Readonly<Record<CredentialKind, TakenFields>> = {
  none: { required: [], optional: [] },
  reference: { required: ['variable', 'name', 'in'], optional: ['scheme'] },
  secret: { required: ['name', 'in'], optional: ['scheme', ...keyFieldNames] },
  client_credentials: { required: ['issuer'], optional: ['client_id', 'scope'], recorded: ['parameters'] },
  authorization: {
    required: ['issuer'],
    optional: ['scope', 'parameters', ...consentEndpoints, 'pkce', 'clients', 'client_id', 'client_source'],
    recorded: ['installation'],
  },
  jwt_bearer: { required: ['issuer'], optional: ['subject', 'client_id', 'scope', 'token_request'] },
};

function fieldsTakenBy(credential: CredentialFields): TakenFields {
  return isThroughAGateway(credential) ? fieldsThroughAGateway : fieldsOfEachKind[credential.kind];
}

const placesOtherThanAHeader: Readonly<Record<Exclude<Placement, 'header'>, string>> = {
  query: 'a query parameter',
  security: 'a security scheme of the document, which says how the value is sent',
};

interface FieldIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

function credentialOfKind(kind: CredentialKind): string {
  return articled(`${kind} credential`);
}

function fieldsTakenInWords({ required, optional }: TakenFields): string {
  const taken = [...required, ...optional];
  return taken.length === 0 ? 'no other field' : listed(taken);
}

function presenceIssuesOf(credential: CredentialFields): readonly FieldIssue[] {
  const taken = fieldsTakenBy(credential);
  const { required, optional, recorded = [] } = taken;
  const named = isThroughAGateway(credential) ? credentialThroughAGateway : credentialOfKind(credential.kind);
  return everyFieldButTheScheme.flatMap((field): readonly FieldIssue[] => {
    const given = credential[field] !== undefined;
    if (!given && required.includes(field)) {
      return [{ path: [field], issue: `Expected ${field}, which ${named} takes` }];
    }
    return given && !required.includes(field) && !optional.includes(field) && !recorded.includes(field)
      ? [{ path: [field], issue: `Expected no ${field}: ${named} takes ${fieldsTakenInWords(taken)}` }]
      : [];
  });
}

function schemeIssueOf(credential: CredentialFields, scheme: string): string | undefined {
  const { kind, in: placement } = credential;
  if (!fieldsOfEachKind[kind].optional.includes('scheme') && !isThroughAGateway(credential)) {
    return `Expected no scheme: ${credentialOfKind(kind)} places no value in a header for the runtime to write a scheme before`;
  }
  if (placement !== undefined && placement !== 'header') {
    return `Expected no scheme, which goes before a value sent in a header: this credential is sent in ${placesOtherThanAHeader[placement]}`;
  }
  if (scheme.includes('$')) {
    return 'Expected a scheme without $, which the reading of the entry takes for a reference or an escape';
  }
  return headerNamePattern.test(scheme)
    ? undefined
    : 'Expected a scheme of the characters a header name holds, such as Bearer';
}

function schemeIssuesOf(credential: CredentialFields): readonly FieldIssue[] {
  const issue = credential.scheme === undefined ? undefined : schemeIssueOf(credential, credential.scheme);
  return issue === undefined ? [] : [{ path: ['scheme'], issue }];
}

const addressesOfEachKind: Partial<Readonly<Record<CredentialKind, readonly WayAddress[]>>> = {
  client_credentials: ['issuer'],
  authorization: wayAddresses,
  jwt_bearer: ['issuer'],
};

function addressIssuesOf(credential: CredentialFields): readonly FieldIssue[] {
  return (addressesOfEachKind[credential.kind] ?? []).flatMap((field) => {
    const address = credential[field];
    return address === undefined || isPinnableUrl(address) ? [] : [{ path: [field], issue: pinnedUrlShape }];
  });
}

function consentIssuesOfTheKind(credential: CredentialFields): readonly FieldIssue[] {
  return credential.kind === 'authorization' ? consentIssuesOf(credential) : [];
}

const credentialledHow = 'How the server is credentialled, never its value, which the person gives on the page';

export const credentialDescription = `${credentialledHow}; leave it out for an MCP server given by hand, which says how it authenticates, and name a kind only for one that names none`;

export function credentialFieldIssuesOf(credential: CredentialFields): readonly FieldIssue[] {
  return [
    ...presenceIssuesOf(credential),
    ...gatewayPlacementIssuesOf(credential),
    ...variableIssuesOf(credential),
    ...nameIssuesOf(credential),
    ...schemeIssuesOf(credential),
    ...addressIssuesOf(credential),
    ...consentIssuesOfTheKind(credential),
  ];
}

const kindsPlacingNoValue: ReadonlySet<CredentialKind> = new Set(['none', 'authorization']);

export function placesNoValue(credential: Pick<CredentialFields, 'kind' | 'client_source'>): boolean {
  return kindsPlacingNoValue.has(credential.kind) && !isThroughAGateway(credential);
}

export const CredentialSchema = CredentialFieldsSchema.annotate({ description: credentialledHow }).check(
  Schema.makeFilter((credential: CredentialFields) => credentialFieldIssuesOf(credential)),
);

export type Credential = typeof CredentialSchema.Type;
