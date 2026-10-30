import { signInScopes, type ProtectedResource } from '@on.auto/identity';

import type { RouteHandler } from '../routes.ts';
import { metadataPath, namesAnEndpoint } from './challenges.ts';

const resourceDocumentation = 'https://on.auto/docs/reference/mcp';

export interface MetadataRoute {
  readonly path: string;
  readonly handler: RouteHandler;
}

const endpointPaths: readonly string[] = ['', '/mcp', '/orgs/:org/mcp', '/orgs/:org/playbooks/:playbook/mcp'];

function answeredFor({ publicUrl, authorizationServers }: ProtectedResource): RouteHandler {
  return (c) =>
    namesAnEndpoint(c.req.param('org'), c.req.param('playbook'))
      ? c.json(
          {
            resource: `${publicUrl}${c.req.path.slice(metadataPath.length)}`,
            authorization_servers: authorizationServers,
            bearer_methods_supported: ['header'],
            scopes_supported: signInScopes,
            resource_documentation: resourceDocumentation,
          },
          200,
          { 'cache-control': 'no-store' },
        )
      : c.notFound();
}

export function isMetadataPath(path: string): boolean {
  return path === metadataPath || path.startsWith(`${metadataPath}/`);
}

export function protectedResourceRoutes(resource: ProtectedResource | undefined): readonly MetadataRoute[] {
  return resource === undefined
    ? []
    : endpointPaths.map((path) => ({ path: `${metadataPath}${path}`, handler: answeredFor(resource) }));
}
