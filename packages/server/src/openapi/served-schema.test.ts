import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { givenGoals } from '../testing/settings/goals-kept.ts';

let server: ReasoningServer;

const keptSchema = new URL('../../../../docs/assets/schema.graphql', import.meta.url);

beforeAll(async () => {
  server = await servingReasoning([], undefined, undefined, { goals: true, goalsResults: true });
});

afterAll(async () => {
  await server.stop();
});

describe('the query schema the server serves, as it is kept', () => {
  it('is the kept schema, docs/assets/schema.graphql; pnpm docs:openapi writes it again', async () => {
    const served = await (await fetch(`${server.origin}/v1/schema.graphql`)).text();

    expect(served).toBe(readFileSync(keptSchema, 'utf8'));
  });
});

describe('the query endpoint of the server', () => {
  it('reads the org’s playbooks and the definitions of each in one request, with the cursor of the org’s changes', async () => {
    await server.call('POST', '/v1/orgs/local/playbooks', {
      body: { playbook: 'alpha', name: 'Alpha', goals: givenGoals },
    });

    const answered = await server.call('POST', '/v1/orgs/local/query', {
      body: {
        query: '{ list_playbooks { playbooks { id list_definitions(type: "workflow") { definitions { name } } } } }',
      },
    });

    expect(answered.status).toBe(200);
    expect(answered.body).toMatchObject({
      data: { list_playbooks: { playbooks: [{ id: 'alpha', list_definitions: { definitions: [] } }] } },
    });
    expect(answered.text).toMatch(/"cursor":"[^"]+"/u);
  });
});

describe('the query endpoint of the server, with the changes of the org', () => {
  it('answers what it read, and from its cursor one held request of the org learns of a change in any playbook', async () => {
    await server.call('POST', '/v1/orgs/local/playbooks', {
      body: { playbook: 'beta', name: 'Beta', goals: givenGoals },
    });
    const answered = await server.call('POST', '/v1/orgs/local/query', {
      body: {
        query: '{ list_playbooks { playbooks { id list_definitions(type: "reasoning") { definitions { name } } } } }',
      },
    });
    const { extensions } = Schema.decodeUnknownSync(AnsweredSchema)(answered.body);

    const held = server.call(
      'GET',
      `/v1/orgs/local/changes?scope=org_and_playbooks&since=${extensions.cursor}&wait=20`,
    );
    await server.call('POST', '/v1/orgs/local/playbooks/beta/definitions/reasoning', {
      body: { name: 'summary', source: summary, diagram: 'none' },
    });

    expect(extensions.read).toEqual(
      expect.arrayContaining([
        { kind: 'playbook' },
        { kind: 'definition', playbook: 'alpha' },
        { kind: 'definition', playbook: 'beta' },
      ]),
    );
    expect(await held).toMatchObject({
      status: 200,
      body: { changes: [{ kind: 'definition', type: 'reasoning', name: 'summary', playbook: 'beta' }] },
    });
  });
});

const AnsweredSchema = Schema.Struct({
  extensions: Schema.Struct({ cursor: Schema.String, read: Schema.Array(Schema.Unknown) }),
});

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes a text',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');
