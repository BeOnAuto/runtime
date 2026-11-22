import { listed } from '@on.auto/phrasing';
import { isScope, wayClientSources } from '@on.auto/tool-servers';

import { notScopes } from './scope-groups.ts';
import { wayAddresses, type WayAddress } from './templates.ts';

interface WayIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

type ConsentEndpoint = Exclude<WayAddress, 'issuer'>;

export const consentEndpoints: readonly ConsentEndpoint[] = wayAddresses.filter(
  (field): field is ConsentEndpoint => field !== 'issuer',
);

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

export interface ConsentFields extends Partial<Readonly<Record<ConsentEndpoint, string>>> {
  readonly scope?: string;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly pkce?: string;
  readonly clients?: readonly string[];
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
