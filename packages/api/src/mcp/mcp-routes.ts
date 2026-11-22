import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import type { OperationScope } from '@on.auto/operations';

import { admissionAt } from '../authentication/endpoint-admission.ts';
import { actingAsIn, tracedBy } from '../hand-off/caller-hand-off.ts';
import { EndpointHandOffs, type HandOff } from '../hand-off/endpoint-hand-off.ts';
import { requestBodyLimit } from '../operations/request-body.ts';
import type { RegisterRoutes, RouteHandler, Routes } from '../routes.ts';
import { linkedAnswers, type RetryStateKeys } from '../tools/linked-answers.ts';
import type { McpServing } from './mcp-connection.ts';
import {
  playbookServerFactory,
  catalogServerFactory,
  directoryServerFactory,
  listingsOf,
  orgServerFactory,
  type McpServerFactory,
} from './mcp-server-factory.ts';

export interface DirectoryListingServing {
  readonly catalog: McpServing['catalog'];
  readonly shelf: McpServing['shelf'];
}

export interface McpRoutesOptions extends McpServing {
  readonly reportError: (error: Readonly<Error>) => void;
  readonly retryStateKeys: RetryStateKeys;
  readonly heartbeatEveryMs?: number;
  readonly directoryListing?: DirectoryListingServing;
}

export const heartbeatEveryMs = 5000;

function endpoint(handedOff: HandOff, scope: OperationScope, { resource, callContext }: Routes): RouteHandler {
  return (c) => {
    const org = String(c.req.param('org'));
    const playbook = scope === 'playbook' ? String(c.req.param('playbook')) : undefined;
    const principal = c.get('principal');
    const admission = admissionAt(principal.callerIn(org), org, playbook, resource);
    if ('refused' in admission) {
      return admission.refused;
    }
    const handedOver = {
      ...actingAsIn(principal, admission.caller, org),
      requestId: c.get('requestId'),
      context: callContext(c.req.raw),
      ...tracedBy(c.get('traceParent')),
    };
    const call = playbook === undefined ? handedOver : { ...handedOver, playbook };
    return handedOff(c.req.raw, call);
  };
}

function ownOrgEndpoint(handedOff: HandOff, { callContext }: Routes): RouteHandler {
  return (c) => {
    const principal = c.get('principal');
    return handedOff(c.req.raw, {
      ...actingAsIn(principal, principal.own, principal.own.org),
      requestId: c.get('requestId'),
      context: callContext(c.req.raw),
      ...tracedBy(c.get('traceParent')),
    });
  };
}

function handlerFor(
  factory: McpServerFactory,
  { reportError, heartbeatEveryMs: every = heartbeatEveryMs }: McpRoutesOptions,
): McpHttpHandler {
  return createMcpHandler(factory, {
    legacy: 'stateless',
    responseMode: 'sse',
    keepAliveMs: every,
    maxRequestBodySize: requestBodyLimit,
    onerror: reportError,
  });
}

export function mcpRoutes(options: McpRoutesOptions): RegisterRoutes {
  return (routes) => {
    const serving = {
      ...options,
      reportThrown: routes.reportThrown,
      linkedAnswers: linkedAnswers(options.retryStateKeys),
    };
    const handOffs = new EndpointHandOffs();
    const directoryServing = { ...serving, ...options.directoryListing };
    const catalog = handlerFor(catalogServerFactory(serving), options);
    const org = handlerFor(orgServerFactory(serving), options);
    const playbook = handlerFor(playbookServerFactory(serving), options);
    const directory = handlerFor(directoryServerFactory(directoryServing), options);
    const listings = listingsOf(serving, directoryServing);
    const to = (fetchMcp: McpHttpHandler['fetch'], served: keyof typeof listings) =>
      handOffs.to(fetchMcp, served === 'directory' ? directoryServing.shelf : serving.shelf, listings[served]);
    routes.add('POST', '/mcp', ownOrgEndpoint(to(catalog.fetch, 'own org'), routes));
    routes.add('POST', '/directory', ownOrgEndpoint(to(directory.fetch, 'directory'), routes));
    routes.add('POST', '/orgs/:org/mcp', endpoint(to(org.fetch, 'org'), 'org', routes));
    routes.add(
      'POST',
      '/orgs/:org/playbooks/:playbook/mcp',
      endpoint(to(playbook.fetch, 'playbook'), 'playbook', routes),
    );
    routes.onClose(async () => {
      handOffs.stop();
      await Promise.all([catalog.close(), org.close(), playbook.close(), directory.close()]);
    });
  };
}
