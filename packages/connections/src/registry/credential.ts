import { variableNamePattern } from '@on.auto/config';
import { listed } from '@on.auto/operations';
import { wayFields } from '@on.auto/providers';
import { headerNamePattern, isPinnableUrl, pinnedUrlShape } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const credentialKinds = ['none', 'reference', 'secret', 'client_credentials'] as const;

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
    wayFields.issuer.annotate({ description: 'For client_credentials, the https URL of the authorization server' }),
  ),
  client_id: Schema.optionalKey(
    NamedSchema.annotate({
      description: 'For client_credentials, the id of the client, else given on the page',
    }),
  ),
  scope: Schema.optionalKey(
    wayFields.scope.annotate({
      description: 'For client_credentials, the scopes, separated by spaces; none when left out',
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
};

const placesOtherThanAHeader: Readonly<Record<Exclude<Placement, 'header'>, string>> = {
  query: 'a query parameter',
  security: 'a security scheme of the document, which says how the value is sent',
};

interface FieldIssue {
  readonly path: readonly [Field];
  readonly issue: string;
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
      return [{ path: [field], issue: `Expected ${field}, which a ${credential.kind} credential takes` }];
    }
    return given && !required.includes(field) && !optional.includes(field)
      ? [
          {
            path: [field],
            issue: `Expected no ${field}: a ${credential.kind} credential takes ${fieldsTakenInWords(taken)}`,
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
    return `Expected no scheme: a ${kind} credential places no value in a header for the runtime to write a scheme before`;
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

function issuerIssuesOf({ kind, issuer }: CredentialFields): readonly FieldIssue[] {
  return kind !== 'client_credentials' || issuer === undefined || isPinnableUrl(issuer)
    ? []
    : [{ path: ['issuer'], issue: pinnedUrlShape }];
}

export const credentialDescription =
  'How the server is credentialled, never its value, which the person gives on the page';

export function credentialFieldIssuesOf(credential: CredentialFields): readonly FieldIssue[] {
  return [
    ...presenceIssuesOf(credential),
    ...variableIssuesOf(credential),
    ...nameIssuesOf(credential),
    ...schemeIssuesOf(credential),
    ...issuerIssuesOf(credential),
  ];
}

export const CredentialSchema = CredentialFieldsSchema.annotate({ description: credentialDescription }).check(
  Schema.makeFilter((credential: CredentialFields) => credentialFieldIssuesOf(credential)),
);

export type Credential = typeof CredentialSchema.Type;
