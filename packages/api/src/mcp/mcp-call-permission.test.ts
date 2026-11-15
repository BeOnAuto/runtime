import {
  CallPermission,
  callPermissionDecidedBy,
  type AccessDecision,
  type PolicyDecisionPoint,
} from '@on.auto/operations';
import { Context, Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { guideToolName, toolNamesIn } from '../testing/tool-listing.ts';

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['by-the-test'], errors: [] };

const denied: AccessDecision = { decision: 'deny', determiningPolicies: [], errors: [] };

const queriesAlone: PolicyDecisionPoint = {
  decide: (request) => Effect.succeed(request.context.operation.kind === 'query' ? allowed : denied),
};

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({
    callContext: () => Context.make(CallPermission, callPermissionDecidedBy(queriesAlone)),
  });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function listedOn(path: string): Promise<readonly string[]> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => toolNamesIn(await session.listTools()),
  );
}

describe('the tools an endpoint lists, where the context of the call says a decision point decides who may call what', () => {
  it('are those the decision point allows the caller, asked once for each tool, whatever the credential grants', async () => {
    expect({
      playbook: await listedOn('/orgs/acme/playbooks/alpha/mcp'),
      org: await listedOn('/orgs/acme/mcp'),
      ownOrg: await listedOn('/mcp'),
    }).toEqual({
      playbook: ['list_notes', 'get_note', 'latest_note', 'break_down', 'wait_forever', guideToolName],
      org: ['list_labels', guideToolName],
      ownOrg: ['list_labels', 'list_notes', 'get_note', 'latest_note', 'break_down', 'wait_forever', guideToolName],
    });
  });
});
