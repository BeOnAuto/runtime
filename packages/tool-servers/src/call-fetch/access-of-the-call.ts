import { Effect } from 'effect';

import { toolAccessOf, type ToolAccess, type ToolAccessOptions } from '../access/tool-access.ts';
import type { ConsentTokenSources } from '../clients/token-source.ts';
import type { ToolServers } from '../openapi/described-api.ts';
import { overFetches } from './over-fetches.ts';

export function makeToolAccess(settings: ToolServers, options: ToolAccessOptions): ToolAccess {
  const own = toolAccessOf(settings, options);
  const { ofTheCall } = overFetches({ fetch: options.fetch ?? globalThis.fetch, made: own }, (fetch) => {
    const consent: ConsentTokenSources = {
      tokenSource: (served, serving) => options.consent.tokenSource(served, { ...serving, fetch }),
    };
    return toolAccessOf(settings, { ...options, fetch, consent }, own.linksSendingNoRequest);
  });
  return {
    configured: own.configured,
    takesConnections: own.takesConnections,
    callMs: own.callMs,
    open: (context, references) => Effect.flatMap(ofTheCall, (access) => access.open(context, references)),
    named: (address, references) => Effect.flatMap(ofTheCall, (access) => access.named(address, references)),
    callOnce: (call, runCall) => Effect.flatMap(ofTheCall, (access) => access.callOnce(call, runCall)),
    preparedCall: (call) => Effect.flatMap(ofTheCall, (access) => access.preparedCall(call)),
    listServers: (scope, named) => Effect.flatMap(ofTheCall, (access) => access.listServers(scope, named)),
    listServersInOrg: (scope, named) => Effect.flatMap(ofTheCall, (access) => access.listServersInOrg(scope, named)),
    lookUp: (address, reference) => Effect.flatMap(ofTheCall, (access) => access.lookUp(address, reference)),
    close: own.close,
  };
}
