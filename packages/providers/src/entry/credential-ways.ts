import { alternatives, articled, listed } from '@on.auto/phrasing';
import { WayClientSourceSchema, WayPkceSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { keyFieldNames, keyWayFields, keyWayIssuesOf } from '../keys/key-fields.ts';
import { AccountTypesSchema, accountTypeIssuesOf, isTheWayAsked } from './account-types.ts';
import { consentEndpoints, consentIssuesOf } from './consent-fields.ts';
import { endingIssuesOf } from './ending-codes.ts';
import { GatewaySchema, PermissionsSchema, gatewayIssuesOf, wayThroughAGateway } from './gateway-ways.ts';
import { ScopeGroupSchema, ScopeWordsSchema, groupIssuesOf, wordsIssuesOf } from './scope-groups.ts';
import { clientIdTitleField, ownValueFields } from './way-values.ts';

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
  ending_codes: Schema.Array(NamedSchema).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  gateway: GatewaySchema,
  permissions: PermissionsSchema,
  account_types: AccountTypesSchema,
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
  ending_codes: Schema.optionalKey(
    wayFields.ending_codes.annotate({
      description:
        'For authorization, the error codes beside invalid_grant with which the token endpoint refuses a refresh because the consent has ended, so that the connection is broken rather than failing',
    }),
  ),
  gateway: Schema.optionalKey(wayFields.gateway),
  permissions: Schema.optionalKey(wayFields.permissions),
  account_types: Schema.optionalKey(wayFields.account_types),
  ...ownValueFields,
  ...keyWayFields,
  client_id_title: clientIdTitleField,
  description: Schema.optionalKey(NamedSchema),
});

type CredentialWayFields = typeof CredentialWayFieldsSchema.Type;

type Field = Exclude<keyof CredentialWayFields, 'kind' | 'description'>;

interface TakenFields {
  readonly required: readonly Field[];
  readonly optional: readonly Field[];
}

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
  'ending_codes',
  'gateway',
  'permissions',
  'account_types',
  'placeholders',
  'base_url',
  ...keyFieldNames,
  'key_page_title',
  'client_id_title',
  'steps',
  'app_credentials',
  'test',
];

const ownValues: readonly Field[] = ['placeholders', 'base_url'];

const fieldsOfEachKind: Readonly<Record<WayKind, TakenFields>> = {
  secret: {
    required: ['in', 'name', 'instructions', 'key_page'],
    optional: [
      'key_page_title',
      'steps',
      'scheme',
      'example',
      'pattern',
      'app_credentials',
      'test',
      'permissions',
      'account_types',
      ...ownValues,
    ],
  },
  client_credentials: {
    required: ['issuer'],
    optional: ['scope', 'says', 'key_page', 'key_page_title', 'client_id_title', 'steps', ...ownValues],
  },
  none: { required: [], optional: [] },
  authorization: {
    required: ['issuer'],
    optional: [
      'scope',
      'says',
      'parameters',
      ...consentEndpoints,
      'pkce',
      'clients',
      'oauth_client',
      'more',
      'ending_codes',
      'gateway',
      'permissions',
      'account_types',
      ...ownValues,
    ],
  },
};

const fieldsThroughAGateway: TakenFields = {
  required: ['issuer', 'gateway', 'in', 'name'],
  optional: ['scope', 'says', 'permissions', 'account_types'],
};

function fieldsTakenBy(way: CredentialWayFields): TakenFields {
  return way.kind === 'authorization' && way.gateway !== undefined ? fieldsThroughAGateway : fieldsOfEachKind[way.kind];
}

function wayInWords(way: CredentialWayFields): string {
  return way.kind === 'authorization' && way.gateway !== undefined ? wayThroughAGateway : articled(`${way.kind} way`);
}

interface WayIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

type EntryIssue = Schema.FilterIssue;

function takenInWords({ required, optional }: TakenFields): string {
  const taken = [...required, ...optional];
  return taken.length === 0 ? 'no other field but its description' : listed(taken);
}

function presenceIssuesOf(way: CredentialWayFields): readonly WayIssue[] {
  const taken = fieldsTakenBy(way);
  const named = wayInWords(way);
  return everyField.flatMap((field): readonly WayIssue[] => {
    const given = way[field] !== undefined;
    if (!given && taken.required.includes(field)) {
      return [{ path: [field], issue: `Expected ${field}, which ${named} takes` }];
    }
    return given && !taken.required.includes(field) && !taken.optional.includes(field)
      ? [{ path: [field], issue: `Expected no ${field}: ${named} takes ${takenInWords(taken)}` }]
      : [];
  });
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
  const issues = [
    ...presenceIssuesOf(way),
    ...wordsIssuesOf(way.scope, way.says),
    ...keyWayIssuesOf(way),
    ...accountTypeIssuesOf(way),
  ];
  return way.kind === 'authorization'
    ? [
        ...issues,
        ...consentIssuesOf(way),
        ...oauthClientIssuesOf(way),
        ...groupIssuesOf(way),
        ...endingIssuesOf(way),
        ...gatewayIssuesOf(way),
      ]
    : issues;
}
export const CredentialWaySchema = CredentialWayFieldsSchema.check(Schema.makeFilter(wayIssuesOf));

export type CredentialWay = typeof CredentialWaySchema.Type;

const oneWayOfEachKind =
  'Expected a kind and permissions no earlier way has together, since a provider takes one way of each kind with application permissions and one with delegated permissions, and an authorization way names in more what a later consent may add';

export function repeatedWayIssuesOf(credentials: readonly CredentialWay[]): readonly EntryIssue[] {
  return credentials.flatMap((way, index): readonly EntryIssue[] =>
    credentials.findIndex((earlier) => isTheWayAsked(earlier, way)) === index
      ? []
      : [{ path: ['credentials', index, 'kind'], issue: oneWayOfEachKind }],
  );
}
