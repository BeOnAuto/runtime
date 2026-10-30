import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import type { OperationScope } from '@on.auto/operations';

import { admissionAt } from '../authentication/endpoint-admission.ts';
import { tracedBy } from '../hand-off/caller-hand-off.ts';
import { EndpointHandOffs, type HandOff } from '../hand-off/endpoint-hand-off.ts';
import { requestBodyLimit } from '../operations/request-body.ts';
import type { RegisterRoutes, RouteHandler, Routes } from '../routes.ts';
import { linkedAnswers, type RetryStateKeys } from '../tools/linked-answers.ts';
import type { McpServing } from './mcp-connection.ts';
import {
  playbookServerFactory,
  catalogServerFactory,
  orgServerFactory,
  type McpServerFactory,
} from './mcp-server-factory.ts';

export interface McpRoutesOptions extends McpServing {
  readonly reportError: (error: Readonly<Error>) => void;
  readonly retryStateKeys: RetryStateKeys;
  readonly heartbeatEveryMs?: number;
}

export const heartbeatEveryMs = 5000;

function endpoint(handedOff: HandOff, scope: OperationScope, { resource, callContext }: Routes): RouteHandler {
  return (c) => {
    const org = String(c.req.param('org'));
    const playbook = scope === 'playbook' ? String(c.req.param('playbook')) : undefined;
    const admission = admissionAt(c.get('principal').callerIn(org), org, playbook, resource);
    if ('refused' in admission) {
      return admission.refused;
    }
    const { caller } = admission;
    const handedOver = {
      caller,
      org,
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
    const { own } = c.get('principal');
    return handedOff(c.req.raw, {
      caller: own,
      org: own.org,
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
    const catalog = handlerFor(catalogServerFactory(serving), options);
    const org = handlerFor(orgServerFactory(serving), options);
    const playbook = handlerFor(playbookServerFactory(serving), options);
    routes.add('POST', '/mcp', ownOrgEndpoint(handOffs.to(catalog.fetch), routes));
    routes.add('POST', '/orgs/:org/mcp', endpoint(handOffs.to(org.fetch), 'org', routes));
    routes.add('POST', '/orgs/:org/playbooks/:playbook/mcp', endpoint(handOffs.to(playbook.fetch), 'playbook', routes));
    routes.onClose(async () => {
      handOffs.stop();
      await Promise.all([catalog.close(), org.close(), playbook.close()]);
    });
  };
}
