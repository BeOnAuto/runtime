import { variableNamePattern } from '@on.auto/config';
import { articled, listed } from '@on.auto/operations';
import {
  consentEndpoints,
  consentIssuesOf,
  holdsAClientId,
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
} from '@on.auto/tool-servers';
import { Schema } from 'effect';

const credentialKinds = ['none', 'reference', 'secret', 'client_credentials', 'authorization'] as const;

export const CredentialKindSchema = Schema.Literals(credentialKinds);

export type CredentialKind = typeof CredentialKindSchema.Type;

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

export const CredentialFieldsSchema = Schema.Struct({
  kind: CredentialKindSchema,
  variable: Schema.optionalKey(
    NamedSchema.annotate({
      description: 'For reference, the variable of the runtime that holds the value, such as CRM_API_KEY',
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
      description: 'For client_credentials and authorization, the https URL of the authorization server',
    }),
  ),
  client_id: Schema.optionalKey(
    ClientIdSchema.annotate({
      description:
        'For client_credentials, the id of the client, else given on the page; for authorization, the id of the client the connection was made with, once connected',
    }),
  ),
  scope: Schema.optionalKey(
    wayFields.scope.annotate({
      description:
        'For client_credentials and authorization, the scopes, separated by spaces, none when left out; for authorization once connected, the scopes allowed',
    }),
  ),
  parameters: Schema.optionalKey(
    wayFields.parameters.annotate({
      description: 'For authorization, the parameters its authorization request carries beside the standard ones',
    }),
  ),
  authorization_endpoint: Schema.optionalKey(
    wayFields.authorization_endpoint.annotate({
      description: 'For authorization, the authorization endpoint, where the server publishes no metadata',
    }),
  ),
  token_endpoint: Schema.optionalKey(
    wayFields.token_endpoint.annotate({ description: 'For authorization, the token endpoint, beside the other two' }),
  ),
  revocation_endpoint: Schema.optionalKey(
    wayFields.revocation_endpoint.annotate({
      description: 'For authorization, the revocation endpoint, beside the other two',
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
      description: 'For authorization, the source of the client the connection was made with, once connected',
    }),
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
  'parameters',
  ...consentEndpoints,
  'clients',
  'client_source',
];

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
}

const fieldsOfEachKind: Readonly<Record<CredentialKind, TakenFields>> = {
  none: { required: [], optional: [] },
  reference: { required: ['variable', 'name', 'in'], optional: ['scheme'] },
  secret: { required: ['name', 'in'], optional: ['scheme'] },
  client_credentials: { required: ['issuer'], optional: ['client_id', 'scope'] },
  authorization: {
    required: ['issuer'],
    optional: ['scope', 'parameters', ...consentEndpoints, 'clients', 'client_id', 'client_source'],
  },
};

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
  const taken = fieldsOfEachKind[credential.kind];
  const { required, optional } = taken;
  return everyFieldButTheScheme.flatMap((field): readonly FieldIssue[] => {
    const given = credential[field] !== undefined;
    if (!given && required.includes(field)) {
      return [{ path: [field], issue: `Expected ${field}, which ${credentialOfKind(credential.kind)} takes` }];
    }
    return given && !required.includes(field) && !optional.includes(field)
      ? [
          {
            path: [field],
            issue: `Expected no ${field}: ${credentialOfKind(credential.kind)} takes ${fieldsTakenInWords(taken)}`,
          },
        ]
      : [];
  });
}

function variableIssuesOf({ variable }: CredentialFields): readonly FieldIssue[] {
  return variable === undefined || variableNamePattern.test(variable)
    ? []
    : [{ path: ['variable'], issue: 'Expected the name of a variable, such as CRM_API_KEY' }];
}

function nameIssuesOf({ name, in: placement }: CredentialFields): readonly FieldIssue[] {
  return name !== undefined && placement === 'header' && !headerNamePattern.test(name)
    ? [{ path: ['name'], issue: 'Expected a header name' }]
    : [];
}

function schemeIssueOf({ kind, in: placement }: CredentialFields, scheme: string): string | undefined {
  if (!fieldsOfEachKind[kind].optional.includes('scheme')) {
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

const addressesOfEachKind: Readonly<Record<CredentialKind, readonly WayAddress[]>> = {
  none: [],
  reference: [],
  secret: [],
  client_credentials: ['issuer'],
  authorization: wayAddresses,
};

function addressIssuesOf(credential: CredentialFields): readonly FieldIssue[] {
  return addressesOfEachKind[credential.kind].flatMap((field) => {
    const address = credential[field];
    return address === undefined || isPinnableUrl(address) ? [] : [{ path: [field], issue: pinnedUrlShape }];
  });
}

function consentIssuesOfTheKind(credential: CredentialFields): readonly FieldIssue[] {
  return credential.kind === 'authorization' ? consentIssuesOf(credential) : [];
}

export const credentialDescription =
  'How the server is credentialled, never its value, which the person gives on the page';

export function credentialFieldIssuesOf(credential: CredentialFields): readonly FieldIssue[] {
  return [
    ...presenceIssuesOf(credential),
    ...variableIssuesOf(credential),
    ...nameIssuesOf(credential),
    ...schemeIssuesOf(credential),
    ...addressIssuesOf(credential),
    ...consentIssuesOfTheKind(credential),
  ];
}

export function takesAClientId(kind: CredentialKind): boolean {
  return holdsAClientId(kind);
}

const kindsPlacingNoValue: ReadonlySet<CredentialKind> = new Set(['none', 'authorization']);

export function placesNoValue(kind: CredentialKind): boolean {
  return kindsPlacingNoValue.has(kind);
}

export const CredentialSchema = CredentialFieldsSchema.annotate({ description: credentialDescription }).check(
  Schema.makeFilter((credential: CredentialFields) => credentialFieldIssuesOf(credential)),
);

export type Credential = typeof CredentialSchema.Type;
