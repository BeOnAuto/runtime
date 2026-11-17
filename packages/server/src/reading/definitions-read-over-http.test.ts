import { withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { approvalDocument } from '@on.auto/interaction/testing';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';

import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

interface Saved {
  readonly type: string;
  readonly name: string;
  readonly source: string;
}

const approveBrief: Saved = { type: 'interaction', name: 'approve-brief', source: approvalDocument() };

const briefing: Saved = {
  type: 'workflow',
  name: 'briefing',
  source: [
    'document:',
    "  dsl: '1.0.3'",
    '  namespace: acme',
    '  name: briefing',
    "  version: '1.0.0'",
    'do:',
    '  - send:',
    '      call: run_definition',
    '      with: { type: interaction, name: approve-brief, input: { owner: ada, campaign: Spring } }',
    '  - note: { set: { sent: true } }',
    '  - again:',
    '      call: run_definition',
    '      with: { type: interaction, name: approve-brief, input: { owner: ada, campaign: Spring } }',
    '',
  ].join('\n'),
};

const usedByApproveBrief = [
  {
    type: 'workflow',
    name: 'briefing',
    relation: 'calls',
    steps: [
      { number: 1, name: 'send' },
      { number: 3, name: 'again' },
    ],
  },
];

const decodeUsers = Schema.decodeUnknownSync(Schema.Struct({ used_by: Schema.optionalKey(Schema.Array(Schema.Json)) }));

let server: ReasoningServer;

function created({ type, name, source }: Saved): Promise<number> {
  return server
    .call('POST', `${alpha}/definitions/${type}`, {
      key: admin.key,
      body: { name, source, ...(type === 'workflow' ? {} : { diagram: 'none' }) },
    })
    .then(({ status }) => status);
}

async function usersOverHttp({ type, name }: Saved): Promise<unknown> {
  const { body } = await server.call('GET', `${alpha}/definitions/${type}/${name}`, { key: reader.key });
  return decodeUsers(body).used_by;
}

function usersOverMcp(definitions: readonly Saved[]): Promise<readonly unknown[]> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: { authorization: `Bearer ${reader.key}` } },
    (session) =>
      Promise.all(
        definitions.map(
          async ({ type, name }) =>
            decodeUsers((await session.callTool('get_definition', { type, name })).structuredContent).used_by,
        ),
      ),
  );
}

const reserved = [
  'run_started',
  'run_deferred',
  'attempt_resumed',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  'run_cancel_requested',
  'tool_call_started',
  'tool_call_answered',
  'tool_call_failed',
  'model_call_started',
  'model_call_answered',
  'model_call_failed',
  'request_answered',
  'delivery_started',
  'delivery_succeeded',
  'delivery_failed',
  'delivery_refused',
  'reply_refused',
  'interaction_requested',
  'telling_started',
  'telling_succeeded',
  'telling_failed',
  'replies_read',
  'reading_failed',
  'asset_kept',
  'asset_expired',
  'asset_content_removed',
  'workflow_input_applied',
  'step_started',
  'step_waiting',
  'step_finished',
  'step_failed',
  'step_skipped',
  'definition_created',
  'definition_updated',
  'definition_retired',
  'definition_paused',
  'definition_resumed',
  'definition_restored',
  'playbook_page_saved',
  'playbook_goals_saved',
  'playbook_goals_agreed',
  'playbook_import_started',
  'playbook_imported',
  'event_published',
  'reaction_refused',
];

const ofThePlaybook = 'Expected a type of your own, not one the playbook records itself: ';

const decodeRefusal = Schema.decodeUnknownSync(
  Schema.Struct({
    reason: Schema.Literal('invalid_input'),
    errors: Schema.NonEmptyArray(Schema.Struct({ pointer: Schema.Literal('/event/type'), detail: Schema.String })),
  }),
);

function refusalNaming(detail: string) {
  return { reason: 'invalid_input', errors: [{ pointer: '/type', detail }] };
}

const ofRuns = refusalNaming(
  'Expected a type this server runs: reasoning, lookup, interaction, prediction, computation, generation, or workflow',
);

const ofDefinitions = refusalNaming(
  'Expected a type of definition this server keeps: reasoning, lookup, interaction, prediction, computation, generation, or workflow',
);

describe('definitions used by', () => {
  beforeEach(async () => {
    server = await servingReasoning([], { API_KEYS: JSON.stringify([admin.entry, reader.entry]) });
    await server.call('POST', '/v1/orgs/acme/playbooks', {
      key: admin.key,
      body: { playbook: 'alpha', name: 'Alpha' },
    });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('the definitions that use a definition', () => {
    it('are answered with it over HTTP and by the MCP tool, each with its relation and a workflow with its steps', async () => {
      const statuses = [await created(approveBrief), await created(briefing)];
      const overHttp = await Promise.all([approveBrief, briefing].map((saved) => usersOverHttp(saved)));

      expect(statuses).toEqual([201, 201]);
      expect(overHttp).toEqual([usedByApproveBrief, undefined]);
      expect(await usersOverMcp([approveBrief, briefing])).toEqual(overHttp);
    });
  });
});

describe('the types a business may not publish to its playbook', () => {
  it('are the facts the playbook records, those its capabilities declare and every type its feed shows', async () => {
    const serverReservedNames = await servingReasoning([]);
    onTestFinished(serverReservedNames.stop);
    await serverReservedNames.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const refused = await serverReservedNames.call('POST', `${alpha}/events`, {
      body: { event: { source: '/ledger/eu', type: 'request_answered' } },
    });
    const [{ detail }] = decodeRefusal(refused.body).errors;
    const named = detail.replace(ofThePlaybook, '').split(', ');

    expect(refused.status).toBe(422);
    expect(named).toEqual(reserved);
  });
});

describe('unserved types', () => {
  beforeAll(async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('a type the server does not run', () => {
    it('is refused at /type, naming the types it runs or keeps, by every operation that takes one over HTTP', async () => {
      const answers = await Promise.all([
        server.call('GET', `${alpha}/runs?type=forecast`),
        server.call('GET', `${alpha}/analytics?type=forecast`),
        server.call('GET', `${alpha}/definitions/forecast`),
        server.call('POST', `${alpha}/definitions/forecast/brief/run`, { body: { input: {} } }),
      ]);

      expect(answers.map(({ status }) => status)).toEqual([422, 422, 422, 422]);
      expect(answers.map(({ body }) => body)).toMatchObject([ofRuns, ofRuns, ofDefinitions, ofRuns]);
    });

    it('is refused the same way over MCP, as a result the agent can correct', async () => {
      const listed = await withMcpSession(
        'current revision',
        { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
        (session) => session.callTool('list_runs', { type: 'forecast' }),
      );

      expect(listed.isError).toBe(true);
      expect(JSON.stringify(listed.content)).toContain(
        'Expected a type this server runs: reasoning, lookup, interaction, prediction, computation, generation, or workflow',
      );
    });
  });
});
