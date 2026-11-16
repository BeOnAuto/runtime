import {
  defineCommand,
  defineQuery,
  type AccessDecision,
  type AccessRequest,
  type ArrivedVia,
  type PolicyDecisionPoint,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';

const namingWhatARunCarries = Schema.Struct({
  lineage: Schema.optionalKey(Schema.String),
  calledBy: Schema.optionalKey(Schema.String),
  trigger: Schema.optionalKey(Schema.String),
});

const kept = Schema.Struct({ kept: Schema.Boolean });

const keepNote = defineCommand('org', {
  name: 'keep_note',
  title: 'Keep note',
  description: 'Keeps a note of the org. Use it when the person writes one. It answers whether it kept it.',
  route: { method: 'POST', path: '/notes' },
  inputSchema: namingWhatARunCarries,
  outputSchema: kept,
  reasons: [],
  handle: () => Effect.succeed({ kept: true }),
  plainLanguage: { task: 'keep a note', attempt: () => 'keep the note', outcome: () => 'Kept the note.' },
});

const readNote = defineQuery('playbook', {
  name: 'read_note',
  title: 'Read note',
  description: 'Reads the note of the playbook. Use it when the person asks for it. It answers whether one is kept.',
  route: { method: 'POST', path: '/note' },
  inputSchema: namingWhatARunCarries,
  outputSchema: kept,
  reasons: [],
  handle: () => Effect.succeed({ kept: true }),
  plainLanguage: { task: 'read the note', attempt: () => 'read the note', outcome: () => 'Read the note.' },
});

const asked: AccessRequest[] = [];

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['every-call'], errors: [] };

const allowingEveryCall: PolicyDecisionPoint = {
  decide: (request) =>
    Effect.sync(() => {
      asked.push(request);
      return allowed;
    }),
};

let server: OperationServer;
let listening: Listening;

beforeAll(async () => {
  server = await operationServer({
    operations: [keepNote, readNote],
    dispatcherOptions: { decidedBy: allowingEveryCall },
  });
  listening = await listenOnLoopback(server.handler);
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const whatARunCarries = { lineage: 'run-1', calledBy: 'run-1', trigger: 'run-1' };

async function calledAsATool(path: string, tool: string, input: Readonly<Record<string, unknown>>): Promise<void> {
  const connection = { url: `${listening.origin}${path}`, headers: asAdmin };
  await withMcpSession('current revision', connection, (session) => session.callTool(tool, input));
}

describe('a call over HTTP or as an MCP tool', () => {
  it('arrives through its credential, never through a run, whatever its input names, since only a host’s own work carries what a run carries', async () => {
    const posted = { method: 'POST', headers: { ...asAdmin, 'content-type': 'application/json' } };
    await call(server.handler, '/v1/orgs/acme/notes', { ...posted, body: JSON.stringify(whatARunCarries) });
    await call(server.handler, '/v1/orgs/acme/playbooks/alpha/note', {
      ...posted,
      body: JSON.stringify(whatARunCarries),
    });
    await calledAsATool('/mcp', 'keep_note', whatARunCarries);
    await calledAsATool('/mcp', 'read_note', { ...whatARunCarries, playbook: 'alpha' });
    await calledAsATool('/orgs/acme/playbooks/alpha/mcp', 'read_note', whatARunCarries);

    const arrived: readonly ArrivedVia[] = asked.map(({ context }) => context.via);

    expect(asked.map(({ action }) => action.name)).toEqual([
      'keep_note',
      'read_note',
      'keep_note',
      'read_note',
      'read_note',
    ]);
    expect(new Set(arrived)).toEqual(new Set(['key']));
  });
});
