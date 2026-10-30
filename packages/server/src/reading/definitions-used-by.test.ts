import { withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { approvalDocument } from '@on.auto/interaction/testing';
import { allPermissions } from '@on.auto/operations';
import { foldOf, recallDocument } from '@on.auto/recall/testing';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

interface Saved {
  readonly type: string;
  readonly name: string;
  readonly source: string;
}

const approveBrief: Saved = { type: 'interaction', name: 'approve-brief', source: approvalDocument() };

function remembering(name: string, filter: readonly string[]): Saved {
  const frontMatter = ['language: typescript', 'source:', '  events:', ...filter, 'view:', '  initial: 0'];
  return { type: 'recall', name, source: recallDocument(foldOf('return view + 1;'), frontMatter.join('\n')) };
}

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

const usingApproveBrief: readonly Saved[] = [
  briefing,
  remembering('brief-answers', ['    - type: run_succeeded', '      subject: interaction/approve-brief']),
  remembering('brief-changes', [
    '    - type: definition_updated',
    '      source: /definitions/interaction/approve-brief',
  ]),
];

const usedByApproveBrief = [
  { type: 'recall', name: 'brief-answers', relation: 'remembers-runs' },
  { type: 'recall', name: 'brief-changes', relation: 'remembers-changes' },
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

beforeEach(async () => {
  server = await servingReasoning([], { API_KEYS: JSON.stringify([admin.entry, reader.entry]) });
  await server.call('POST', '/v1/orgs/acme/playbooks', { key: admin.key, body: { playbook: 'alpha', name: 'Alpha' } });
});

afterEach(async () => {
  await server.stop();
});

function created({ type, name, source }: Saved): Promise<number> {
  return server
    .call('POST', `${alpha}/definitions/${type}`, { key: admin.key, body: { name, source } })
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

describe('the definitions that use a definition', () => {
  it('are answered with it over HTTP and by the MCP tool, each with its relation and a workflow with its steps', async () => {
    const statuses = [
      await created(approveBrief),
      ...(await Promise.all(usingApproveBrief.map((saved) => created(saved)))),
    ];
    const overHttp = await Promise.all([approveBrief, briefing].map((saved) => usersOverHttp(saved)));

    expect(statuses).toEqual([201, 201, 201, 201]);
    expect(overHttp).toEqual([usedByApproveBrief, undefined]);
    expect(await usersOverMcp([approveBrief, briefing])).toEqual(overHttp);
  });
});
