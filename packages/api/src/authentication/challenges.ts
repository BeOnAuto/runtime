import { signInScopes, type ProtectedResource } from '@on.auto/identity';
import { OrgIdSchema, PlaybookIdSchema, type Permission } from '@on.auto/operations';
import { Schema } from 'effect';

import { problemOf } from '../problem/problem.ts';

export const metadataPath = '/.well-known/oauth-protected-resource';

export const callerOfAnotherOrg = problemOf('forbidden', 'The caller does not belong to this org');

const isOrgId = Schema.is(OrgIdSchema);

const isPlaybookId = Schema.is(PlaybookIdSchema);

export function namesAnEndpoint(org: string | undefined, playbook?: string): boolean {
  return (org === undefined || isOrgId(org)) && (playbook === undefined || isPlaybookId(playbook));
}

export function endpointPathOf(org: string, playbook?: string): string {
  if (!namesAnEndpoint(org, playbook)) {
    return '';
  }
  return playbook === undefined ? `/orgs/${org}/mcp` : `/orgs/${org}/playbooks/${playbook}/mcp`;
}

const mcpEndpoint = /^(?:\/orgs\/([^/]+)(?:\/playbooks\/([^/]+))?)?\/mcp$/u;

export function mcpEndpointPathOf(path: string): string {
  const named = mcpEndpoint.exec(path);
  if (named === null) {
    return '';
  }
  const [, org, playbook] = named;
  return org === undefined ? '/mcp' : endpointPathOf(org, playbook);
}

type Parameter = readonly [string, string];

export type ChallengeHeaders = Readonly<Record<string, string>>;

function challengeOf(parameters: readonly Parameter[]): string {
  return ['Bearer', parameters.map(([name, value]) => `${name}="${value}"`).join(', ')]
    .filter((part) => part !== '')
    .join(' ');
}

function metadataAddressOf({ publicUrl }: ProtectedResource, resourcePath = ''): string {
  return `${publicUrl}${metadataPath}${resourcePath}`;
}

export function unauthenticatedChallenge(resource: ProtectedResource | undefined, refused: boolean): string {
  const error: readonly Parameter[] = refused ? [['error', 'invalid_token']] : [];
  return challengeOf(
    resource === undefined
      ? error
      : [...error, ['resource_metadata', metadataAddressOf(resource)], ['scope', signInScopes.join(' ')]],
  );
}

export function insufficientScope(
  resource: ProtectedResource | undefined,
  permissions: readonly Permission[],
  resourcePath = '',
): ChallengeHeaders {
  const error: Parameter = ['error', 'insufficient_scope'];
  return {
    'www-authenticate': challengeOf(
      resource === undefined
        ? [error]
        : [error, ['scope', permissions.join(' ')], ['resource_metadata', metadataAddressOf(resource, resourcePath)]],
    ),
  };
}
