import { alternatives, articled, listed } from '@on.auto/phrasing';
import { parametersTheRuntimeSets, setInEveryTokenRequestWords } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { keyFieldNames, keyWayFields, keyWayIssuesOf, testIssuesOf } from '../keys/key-fields.ts';
import { accountTypeIssuesOf, isTheWayAsked } from './account-types.ts';
import { assertionFieldNames, assertionFields, assertionIssuesOf } from './assertion-ways.ts';
import { consentEndpoints, consentIssuesOf, oauthClientIssuesOf } from './consent-fields.ts';
import { gatewayIssuesOf, wayThroughAGateway } from './gateway-ways.ts';
import { groupIssuesOf, wordsIssuesOf } from './scope-groups.ts';
import {
  clientIdTitleField,
  limitationSchemaOf,
  mostLimitationCharacters,
  ownValueFields,
  pathValueIssuesOf,
  wayFields,
} from './way-values.ts';

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

export const WayKindSchema = Schema.Literals([
  'secret',
  'client_credentials',
  'none',
  'authorization',
  'jwt_bearer',
  'token_exchange',
]);

export type WayKind = typeof WayKindSchema.Type;

const kindsHoldingAClientId: readonly WayKind[] = ['client_credentials', 'authorization', 'jwt_bearer'];

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
  parameters: Schema.optionalKey(
    wayFields.parameters.annotate({
      description:
        "For authorization, the parameters its authorization request carries beside the standard ones; for client_credentials, those its token request carries, where a grant_type is sent in place of client_credentials; for token_exchange, those its exchange carries, such as requested_token_type. Each value may hold this way's placeholders",
    }),
  ),
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
  refresh_token_expires_in: Schema.optionalKey(
    wayFields.refresh_token_expires_in.annotate({
      description:
        'For authorization, how long the provider keeps a refresh token, in seconds, a whole number above 0, after which the person signs in again; it states what the provider imposes, and Auto enforces nothing from it',
    }),
  ),
  ...ownValueFields,
  ...assertionFields,
  ...keyWayFields,
  client_id_title: clientIdTitleField,
  limitation: Schema.optionalKey(limitationSchemaOf(mostLimitationCharacters)),
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
  'refresh_token_expires_in',
  'placeholders',
  'base_url',
  'path_values',
  ...assertionFieldNames,
  ...keyFieldNames,
  'key_page_title',
  'client_id_title',
  'steps',
  'app_credentials',
  'test',
  'limitation',
];

const ownValues: readonly Field[] = ['placeholders', 'base_url', 'path_values'];

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
      'limitation',
      ...ownValues,
    ],
  },
  client_credentials: {
    required: ['issuer'],
    optional: [
      'scope',
      'says',
      'parameters',
      'key_page',
      'key_page_title',
      'client_id_title',
      'steps',
      'limitation',
      ...ownValues,
    ],
  },
  none: { required: [], optional: [] },
  jwt_bearer: {
    required: ['issuer', 'key_file'],
    optional: [
      'subject',
      'client_id',
      'token_request',
      'scope',
      'says',
      'key_page',
      'key_page_title',
      'steps',
      'limitation',
      ...ownValues,
    ],
  },
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
      'key_page',
      'key_page_title',
      'client_id_title',
      'steps',
      'refresh_token_expires_in',
      'installation',
      'limitation',
      ...ownValues,
    ],
  },
  token_exchange: {
    required: ['token_endpoint', 'audience', 'subject_token'],
    optional: [
      'scope',
      'says',
      'parameters',
      'impersonation',
      'managed_service_account',
      'read_only',
      'test',
      'key_page',
      'key_page_title',
      'steps',
      'limitation',
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

function tokenParameterIssuesOf({ kind, parameters = {} }: CredentialWayFields): readonly WayIssue[] {
  return kind === 'client_credentials'
    ? parametersTheRuntimeSets(parameters).map((name) => ({
        path: ['parameters', name],
        issue: setInEveryTokenRequestWords(name),
      }))
    : [];
}

function wayIssuesOf(way: CredentialWayFields): readonly EntryIssue[] {
  const issues = [
    ...presenceIssuesOf(way),
    ...tokenParameterIssuesOf(way),
    ...pathValueIssuesOf(way),
    ...assertionIssuesOf(way),
    ...wordsIssuesOf(way.scope, way.says),
    ...keyWayIssuesOf(way),
    ...testIssuesOf(way),
    ...accountTypeIssuesOf(way),
  ];
  return way.kind === 'authorization'
    ? [...issues, ...consentIssuesOf(way), ...oauthClientIssuesOf(way), ...groupIssuesOf(way), ...gatewayIssuesOf(way)]
    : issues;
}
export const CredentialWaySchema = CredentialWayFieldsSchema.check(Schema.makeFilter(wayIssuesOf));

export type CredentialWay = typeof CredentialWaySchema.Type;

const oneWayOfEachKind =
  'Expected a kind, permissions and managed_service_account no earlier way has together, since a provider takes one way of each kind with application permissions and one with delegated permissions, a token_exchange way once with managed_service_account and once without, and an authorization way names in more what a later consent may add';

export function repeatedWayIssuesOf(credentials: readonly CredentialWay[]): readonly EntryIssue[] {
  return credentials.flatMap((way, index): readonly EntryIssue[] =>
    credentials.findIndex((earlier) => isTheWayAsked(earlier, way)) === index
      ? []
      : [{ path: ['credentials', index, 'kind'], issue: oneWayOfEachKind }],
  );
}
