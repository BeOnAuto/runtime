import { withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { weeklyOrders } from '@on.auto/prediction/testing';
import { foldOf, recallDocument } from '@on.auto/recall/testing';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: ['alpha'] });

const [, , , sendBuildExample] = blocksInOrderOf('reference/prediction-format.md');

interface Saved {
  readonly type: string;
  readonly name: string;
  readonly source: string;
}

const sendBuild: Saved = { type: 'interaction', name: 'send-build', source: String(sendBuildExample?.body) };

function remembering(name: string, filter: readonly string[]): Saved {
  const frontMatter = ['language: typescript', 'source:', '  events:', ...filter, 'view:', '  initial: 0'];
  return { type: 'recall', name, source: recallDocument(foldOf('return view + 1;'), frontMatter.join('\n')) };
}

const weeklyBuild: Saved = {
  type: 'workflow',
  name: 'weekly-build',
  source: [
    'document:',
    "  dsl: '1.0.3'",
    '  namespace: acme',
    '  name: weekly-build',
    "  version: '1.0.0'",
    'do:',
    '  - send:',
    '      call: run_definition',
    '      with: { type: interaction, name: send-build, input: { build: {} } }',
    '  - note: { set: { sent: true } }',
    '  - again:',
    '      call: run_definition',
    '      with: { type: interaction, name: send-build, input: { build: {} } }',
    '',
  ].join('\n'),
};

const usingSendBuild: readonly Saved[] = [
  weeklyBuild,
  {
    type: 'prediction',
    name: 'weekly-orders',
    source: weeklyOrders.replace('  expires: P7D', '  through: send-build\n  expires: P7D'),
  },
  remembering('build-answers', ['    - type: run_succeeded', '      subject: interaction/send-build']),
  remembering('build-changes', ['    - type: definition_updated', '      source: /definitions/interaction/send-build']),
];

const usedBySendBuild = [
  { type: 'prediction', name: 'weekly-orders', relation: 'sends-builds' },
  { type: 'recall', name: 'build-answers', relation: 'remembers-runs' },
  { type: 'recall', name: 'build-changes', relation: 'remembers-changes' },
  {
    type: 'workflow',
    name: 'weekly-build',
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
    const statuses = [await created(sendBuild), ...(await Promise.all(usingSendBuild.map((saved) => created(saved))))];
    const overHttp = await Promise.all([sendBuild, weeklyBuild].map((saved) => usersOverHttp(saved)));

    expect(statuses).toEqual([201, 201, 201, 201, 201]);
    expect(overHttp).toEqual([usedBySendBuild, undefined]);
    expect(await usersOverMcp([sendBuild, weeklyBuild])).toEqual(overHttp);
  });
});
