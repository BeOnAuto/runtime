import { answers, textResult } from '@on.auto/reasoning/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { documentClientOf, type DocumentClient } from '../testing/openapi/document-client.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

let server: ReasoningServer;
let client: DocumentClient;

beforeAll(async () => {
  server = await servingReasoning([answers(textResult('Profits rose.'))]);
  const documentUrl = `${server.origin}/v1/openapi.json`;
  client = documentClientOf(await (await fetch(documentUrl)).json(), documentUrl);
});

afterAll(async () => {
  await server.stop();
});

const inLocal = { org: 'local' };

describe('a client built from the document alone', () => {
  it('creates a playbook, writes a reasoning function in it and runs it, each call and answer as the document says', async () => {
    const created = await client('create_playbook', { ...inLocal, playbook: 'alpha', name: 'Alpha' });
    const written = await client('create_definition', {
      ...inLocal,
      playbook: 'alpha',
      type: 'reasoning',
      name: 'summary',
      source: summary,
    });
    const ran = await client('run_definition', {
      ...inLocal,
      playbook: 'alpha',
      type: 'reasoning',
      name: 'summary',
      input: { text: 'the quarter' },
    });

    expect([created, written, ran].map(({ status, misfits }) => [status, misfits])).toEqual([
      [201, []],
      [201, []],
      [200, []],
    ]);
    expect(ran.body).toMatchObject({ status: 'succeeded', output: 'Profits rose.' });
  });

  it('reads the playbooks by its query parameters, and a playbook the org lacks as the problem the document gives', async () => {
    const [listed, retiredToo, missing] = await Promise.all([
      client('list_playbooks', inLocal),
      client('list_playbooks', { ...inLocal, include_retired: true }),
      client('get_playbook', { ...inLocal, playbook: 'gamma' }),
    ]);

    expect([listed, retiredToo, missing].map(({ status, misfits }) => [status, misfits])).toEqual([
      [200, []],
      [200, []],
      [404, []],
    ]);
    expect(missing.body).toMatchObject({ reason: 'not_found' });
  });

  it('refuses an operation the document does not describe', async () => {
    await expect(client('fly_playbook', inLocal)).rejects.toThrow('The document describes no operation fly_playbook');
  });
});
