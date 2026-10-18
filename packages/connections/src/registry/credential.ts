import { variableNamePattern } from '@on.auto/config';
import { listed } from '@on.auto/operations';
import { headerNamePattern, isPinnableUrl } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const credentialKinds = ['none', 'reference', 'secret', 'client_credentials'] as const;

export const CredentialKindSchema = Schema.Literals(credentialKinds);

export type CredentialKind = typeof CredentialKindSchema.Type;

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const CredentialFieldsSchema = Schema.Struct({
  kind: CredentialKindSchema,
  variable: Schema.optionalKey(
    NamedSchema.annotate({
      description: 'For reference, the variable of the runtime that holds the value, such as CRM_API_KEY',
    }),
  ),
  name: Schema.optionalKey(
    NamedSchema.annotate({
      description: 'For secret and reference, the header, query parameter or security scheme the value is sent as',
    }),
  ),
  in: Schema.optionalKey(
    Schema.Literals(['header', 'query', 'security']).annotate({
      description:
        'For secret and reference, what name is: header, or for an HTTP API query, a query parameter, or security, a security scheme of its document',
    }),
  ),
  issuer: Schema.optionalKey(
    Schema.String.annotate({ description: 'For client_credentials, the https URL of the authorization server' }),
  ),
  client_id: Schema.optionalKey(NamedSchema.annotate({ description: 'For client_credentials, the id of the client' })),
  scope: Schema.optionalKey(
    Schema.String.annotate({
      description: 'For client_credentials, the scopes, separated by spaces; none when left out',
    }),
  ),
});

type CredentialFields = typeof CredentialFieldsSchema.Type;

type Field = Exclude<keyof CredentialFields, 'kind'>;

const everyField: readonly Field[] = ['variable', 'name', 'in', 'issuer', 'client_id', 'scope'];

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
}

const fieldsOfEachKind: Readonly<Record<CredentialKind, TakenFields>> = {
  none: { required: [], optional: [] },
  reference: { required: ['variable', 'name', 'in'], optional: [] },
  secret: { required: ['name', 'in'], optional: [] },
  client_credentials: { required: ['issuer', 'client_id'], optional: ['scope'] },
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
  return everyField.flatMap((field): readonly FieldIssue[] => {
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

function issuerIssuesOf({ kind, issuer }: CredentialFields): readonly FieldIssue[] {
  return kind !== 'client_credentials' || issuer === undefined || isPinnableUrl(issuer)
    ? []
    : [{ path: ['issuer'], issue: 'Expected an https URL, or an http URL on a loopback address' }];
}

export const CredentialSchema = CredentialFieldsSchema.annotate({
  description: 'How the server is credentialled, never its value, which the person gives on the page',
}).check(
  Schema.makeFilter((credential: CredentialFields) => [
    ...presenceIssuesOf(credential),
    ...variableIssuesOf(credential),
    ...nameIssuesOf(credential),
    ...issuerIssuesOf(credential),
  ]),
);

export type Credential = typeof CredentialSchema.Type;
