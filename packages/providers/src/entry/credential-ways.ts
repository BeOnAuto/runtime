import { alternatives, articled, listed } from '@on.auto/operations';
import { WayClientSourceSchema, isScope, wayClientSources } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { wayAddresses, type WayAddress } from './templates.ts';

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const mostScopeWordsCharacters = 120;

const ScopeWordsSchema = Schema.String.check(
  Schema.isMaxLength(mostScopeWordsCharacters),
  Schema.isPattern(/^[A-Z][^.]*(?:\.[^.\s][^.]*)*\.$/u, {
    expected: 'one sentence that opens with a capital letter and ends with its one period',
  }),
);

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
  clients: Schema.Array(WayClientSourceSchema),
  says: Schema.Record(Schema.String, ScopeWordsSchema),
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
  clients: Schema.optionalKey(wayFields.clients),
  says: Schema.optionalKey(wayFields.says),
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
  'clients',
  'says',
];

const fieldsOfEachKind: Readonly<Record<WayKind, TakenFields>> = {
  secret: { required: ['in', 'name'], optional: ['scheme'] },
  client_credentials: { required: ['issuer'], optional: ['scope', 'says'] },
  none: { required: [], optional: [] },
  authorization: {
    required: ['issuer'],
    optional: ['scope', 'says', 'parameters', ...consentEndpoints, 'clients'],
  },
};

export function asksAScope(kind: WayKind): boolean {
  const { required, optional } = fieldsOfEachKind[kind];
  return [...required, ...optional].includes('scope');
}

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

export interface ConsentFields extends Partial<Readonly<Record<ConsentEndpoint, string>>> {
  readonly scope?: string;
  readonly parameters?: Readonly<Record<string, string>>;
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
  return scope === undefined || isScope(scope)
    ? []
    : [{ path: ['scope'], issue: 'Expected scopes separated by single spaces, such as files.read mail.send' }];
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

export function consentIssuesOf(fields: ConsentFields): readonly WayIssue[] {
  return [
    ...scopeIssuesOf(fields),
    ...parameterIssuesOf(fields),
    ...endpointIssuesOf(fields),
    ...clientIssuesOf(fields),
  ];
}

export function scopesIn(scope: string | undefined): readonly string[] {
  return scope === undefined ? [] : scope.split(' ');
}

export function asksTheSameScopes(one: string | undefined, other: string | undefined): boolean {
  return new Set(scopesIn(one)).symmetricDifference(new Set(scopesIn(other))).size === 0;
}

function wordsIssuesOf({ scope, says = {} }: CredentialWayFields): readonly WayIssue[] {
  const asked = scope === undefined || isScope(scope) ? scopesIn(scope) : Object.keys(says);
  return [
    ...asked
      .filter((name) => !Object.hasOwn(says, name))
      .map((name) => ({
        path: ['says'],
        issue: `Expected words for the scope ${name}: one sentence of at most ${mostScopeWordsCharacters} characters that says what a connection can do through it`,
      })),
    ...Object.keys(says)
      .filter((name) => !asked.includes(name))
      .map((name) => ({ path: ['says', name], issue: 'Expected words only for a scope the way asks' })),
  ];
}

function wayIssuesOf(way: CredentialWayFields): readonly WayIssue[] {
  const issues = [...presenceIssuesOf(way), ...wordsIssuesOf(way)];
  return way.kind === 'authorization' ? [...issues, ...consentIssuesOf(way)] : issues;
}

export const CredentialWaySchema = CredentialWayFieldsSchema.check(Schema.makeFilter(wayIssuesOf));

export type CredentialWay = typeof CredentialWaySchema.Type;
