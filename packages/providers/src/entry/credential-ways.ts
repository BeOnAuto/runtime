import { alternatives, articled, listed } from '@on.auto/operations';
import { WayClientSourceSchema, WayPkceSchema, isScope, wayClientSources } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { ScopeGroupSchema, ScopeWordsSchema, groupIssuesOf, notScopes, wordsIssuesOf } from './scope-groups.ts';
import { wayAddresses, type WayAddress } from './templates.ts';

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

export const wayFields = {
  in: Schema.Literals(['header', 'query', 'security']),
  name: NamedSchema,
  scheme: NamedSchema,
  issuer: Schema.String,
  scope: Schema.String,
  parameters: Schema.Record(Schema.String, Schema.String),
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  revocation_endpoint: Schema.String,
  pkce: WayPkceSchema,
  clients: Schema.Array(WayClientSourceSchema),
  oauth_client: Schema.Literal('required'),
  says: ScopeWordsSchema,
  more: Schema.Array(ScopeGroupSchema).check(Schema.isMinLength(1)),
};

export const WayKindSchema = Schema.Literals(['secret', 'client_credentials', 'none', 'authorization']);

export type WayKind = typeof WayKindSchema.Type;

const kindsHoldingAClientId: readonly WayKind[] = ['client_credentials', 'authorization'];

const kindHoldingAClientId: ReadonlySet<string> = new Set(kindsHoldingAClientId);

export const waysHoldingAClientId = alternatives(kindsHoldingAClientId);

export function holdsAClientId(kind: string): boolean {
  return kindHoldingAClientId.has(kind);
}

const CredentialWayFieldsSchema = Schema.Struct({
  kind: WayKindSchema,
  in: Schema.optionalKey(wayFields.in),
  name: Schema.optionalKey(wayFields.name),
  scheme: Schema.optionalKey(wayFields.scheme),
  issuer: Schema.optionalKey(wayFields.issuer),
  scope: Schema.optionalKey(wayFields.scope),
  parameters: Schema.optionalKey(wayFields.parameters),
  authorization_endpoint: Schema.optionalKey(wayFields.authorization_endpoint),
  token_endpoint: Schema.optionalKey(wayFields.token_endpoint),
  revocation_endpoint: Schema.optionalKey(wayFields.revocation_endpoint),
  pkce: Schema.optionalKey(wayFields.pkce),
  clients: Schema.optionalKey(wayFields.clients),
  oauth_client: Schema.optionalKey(wayFields.oauth_client),
  says: Schema.optionalKey(wayFields.says),
  more: Schema.optionalKey(wayFields.more),
  description: Schema.optionalKey(NamedSchema),
});

type CredentialWayFields = typeof CredentialWayFieldsSchema.Type;

type Field = Exclude<keyof CredentialWayFields, 'kind' | 'description'>;

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
}

type ConsentEndpoint = Exclude<WayAddress, 'issuer'>;

export const consentEndpoints: readonly ConsentEndpoint[] = wayAddresses.filter(
  (field): field is ConsentEndpoint => field !== 'issuer',
);

const everyField: readonly Field[] = [
  'in',
  'name',
  'scheme',
  'issuer',
  'scope',
  'parameters',
  ...consentEndpoints,
  'pkce',
  'clients',
  'oauth_client',
  'says',
  'more',
];

const fieldsOfEachKind: Readonly<Record<WayKind, TakenFields>> = {
  secret: { required: ['in', 'name'], optional: ['scheme'] },
  client_credentials: { required: ['issuer'], optional: ['scope', 'says'] },
  none: { required: [], optional: [] },
  authorization: {
    required: ['issuer'],
    optional: ['scope', 'says', 'parameters', ...consentEndpoints, 'pkce', 'clients', 'oauth_client', 'more'],
  },
};

const parametersTheRequestSets: ReadonlySet<string> = new Set([
  'response_type',
  'response_mode',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
  'request',
  'request_uri',
]);

interface WayIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

type EntryIssue = Schema.FilterIssue;

export interface ConsentFields extends Partial<Readonly<Record<ConsentEndpoint, string>>> {
  readonly scope?: string;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly pkce?: string;
  readonly clients?: readonly string[];
}

function takenInWords({ required, optional }: TakenFields): string {
  const taken = [...required, ...optional];
  return taken.length === 0 ? 'no other field but its description' : listed(taken);
}

function presenceIssuesOf(way: CredentialWayFields): readonly WayIssue[] {
  const taken = fieldsOfEachKind[way.kind];
  return everyField.flatMap((field): readonly WayIssue[] => {
    const given = way[field] !== undefined;
    if (!given && taken.required.includes(field)) {
      return [{ path: [field], issue: `Expected ${field}, which ${articled(`${way.kind} way`)} takes` }];
    }
    return given && !taken.required.includes(field) && !taken.optional.includes(field)
      ? [{ path: [field], issue: `Expected no ${field}: ${articled(`${way.kind} way`)} takes ${takenInWords(taken)}` }]
      : [];
  });
}

function scopeIssuesOf({ scope }: ConsentFields): readonly WayIssue[] {
  return scope === undefined || isScope(scope) ? [] : [{ path: ['scope'], issue: notScopes }];
}

function parameterIssuesOf({ parameters = {} }: ConsentFields): readonly WayIssue[] {
  return Object.keys(parameters)
    .filter((name) => parametersTheRequestSets.has(name))
    .map((name) => ({
      path: ['parameters', name],
      issue: `Expected no ${name}, which the runtime sets in every authorization request itself`,
    }));
}

const endpointsGivenTogether: readonly ConsentEndpoint[] = ['authorization_endpoint', 'token_endpoint'];

function endpointIssuesOf(fields: ConsentFields): readonly WayIssue[] {
  const given = consentEndpoints.filter((endpoint) => fields[endpoint] !== undefined);
  return given.length === 0
    ? []
    : endpointsGivenTogether
        .filter((endpoint) => fields[endpoint] === undefined)
        .map((endpoint) => ({
          path: [endpoint],
          issue: `Expected ${endpoint} beside ${listed(given)}, since a way gives its authorization and token endpoints together`,
        }));
}

const runtimeOrder: readonly string[] = wayClientSources;

function isInTheRuntimesOrder(clients: readonly string[]): boolean {
  const places = clients.map((source) => runtimeOrder.indexOf(source));
  return places.join() === [...new Set(places)].toSorted((one, other) => one - other).join();
}

function clientIssuesOf({ clients }: ConsentFields): readonly WayIssue[] {
  if (clients === undefined) {
    return [];
  }
  return clients.length === 0 || !isInTheRuntimesOrder(clients)
    ? [
        {
          path: ['clients'],
          issue: `Expected at least one client source, each once, in the order the runtime takes them: ${listed(wayClientSources)}`,
        },
      ]
    : [];
}

const confidentialSources: readonly string[] = ['registered'];

function pkceIssueOf(fields: ConsentFields): string | undefined {
  if (endpointsGivenTogether.some((endpoint) => fields[endpoint] === undefined)) {
    return `Expected pkce only beside ${listed(endpointsGivenTogether)}, since the metadata of a server the runtime discovers says the challenges it takes`;
  }
  const { clients = confidentialSources } = fields;
  return clients.every((source) => confidentialSources.includes(source))
    ? undefined
    : 'Expected pkce only on a way whose clients are registered alone, confidential clients whose secret binds the code to the client, since nothing but a challenge binds the code of a public client';
}

function pkceIssuesOf(fields: ConsentFields): readonly WayIssue[] {
  const issue = fields.pkce === undefined ? undefined : pkceIssueOf(fields);
  return issue === undefined ? [] : [{ path: ['pkce'], issue }];
}

export function consentIssuesOf(fields: ConsentFields): readonly WayIssue[] {
  return [
    ...scopeIssuesOf(fields),
    ...parameterIssuesOf(fields),
    ...endpointIssuesOf(fields),
    ...pkceIssuesOf(fields),
    ...clientIssuesOf(fields),
  ];
}

function oauthClientIssuesOf({ oauth_client: oauthClient, clients }: CredentialWayFields): readonly WayIssue[] {
  return oauthClient === undefined || clients === undefined
    ? []
    : [
        {
          path: ['clients'],
          issue:
            "Expected no clients beside oauth_client: a way that requires the organization's own OAuth client takes consent under that client alone",
        },
      ];
}

function wayIssuesOf(way: CredentialWayFields): readonly EntryIssue[] {
  const issues = [...presenceIssuesOf(way), ...wordsIssuesOf(way.scope, way.says)];
  return way.kind === 'authorization'
    ? [...issues, ...consentIssuesOf(way), ...oauthClientIssuesOf(way), ...groupIssuesOf(way)]
    : issues;
}
export const CredentialWaySchema = CredentialWayFieldsSchema.check(Schema.makeFilter(wayIssuesOf));

export type CredentialWay = typeof CredentialWaySchema.Type;
