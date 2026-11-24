import { Effect } from 'effect';

import type { ConnectionWays } from '../access/connection-ways.ts';
import type { ThroughWays } from '../access/through-ways.ts';
import { toolAccessOf, type ToolAccess, type ToolAccessOptions } from '../access/tool-access.ts';
import type { ConsentTokenSources } from '../clients/token-source.ts';
import type { RequestWays } from '../declared-requests/request-ways.ts';
import type { ToolServers } from '../openapi/described-api.ts';
import { overCalls } from './over-calls.ts';

export function makeToolAccess(
  settings: ToolServers,
  options: ToolAccessOptions,
): ToolAccess & RequestWays & ThroughWays & ConnectionWays {
  const own = toolAccessOf(settings, options);
  const owned = { fetch: options.fetch ?? globalThis.fetch, subjectTokens: options.subjectTokens, made: own };
  const ofTheCall = overCalls(owned, ({ fetch, subjectTokens }) => {
    const consent: ConsentTokenSources = {
      tokenSource: (served, serving) => options.consent.tokenSource(served, { ...serving, fetch }),
    };
    const ofTheCallOnly = { ...options, fetch, consent, subjectTokens };
    return toolAccessOf(settings, ofTheCallOnly, own.linksSendingNoRequest, own.listingsKept);
  });
  return {
    assets: own.assets,
    configured: own.configured,
    takesConnections: own.takesConnections,
    callMs: own.callMs,
    mostRequestBytes: own.mostRequestBytes,
    mostRequestBytesTo: own.mostRequestBytesTo,
    open: (context, references) => Effect.flatMap(ofTheCall, (access) => access.open(context, references)),
    named: (address, references) => Effect.flatMap(ofTheCall, (access) => access.named(address, references)),
    callOnce: (call, runCall) => Effect.flatMap(ofTheCall, (access) => access.callOnce(call, runCall)),
    requestOnce: (request) => Effect.flatMap(ofTheCall, (access) => access.requestOnce(request)),
    readOnceThrough: (call, through) => Effect.flatMap(ofTheCall, (access) => access.readOnceThrough(call, through)),
    callAsTheConnection: (call) => Effect.flatMap(ofTheCall, (access) => access.callAsTheConnection(call)),
    preparedCall: (call) => Effect.flatMap(ofTheCall, (access) => access.preparedCall(call)),
    listServers: (scope, named) => Effect.flatMap(ofTheCall, (access) => access.listServers(scope, named)),
    listServersInOrg: (scope, named) => Effect.flatMap(ofTheCall, (access) => access.listServersInOrg(scope, named)),
    lookUp: (address, reference) => Effect.flatMap(ofTheCall, (access) => access.lookUp(address, reference)),
    listConnection: (org, connection) => Effect.flatMap(ofTheCall, (access) => access.listConnection(org, connection)),
    close: own.close,
  };
}
