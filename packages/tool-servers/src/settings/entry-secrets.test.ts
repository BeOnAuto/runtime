import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readEntry, readToolServerSettings } from '../index.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const context = { modelProviders: ['openai'] };

const graph = { url: 'https://graph.example.com/mcp', org: 'acme' };

function refusalOf(servers: unknown) {
  return Effect.runSync(Effect.flip(readToolServerSettings({ TOOL_SERVERS: JSON.stringify(servers) }, context)));
}

describe('the secrets of an entry', () => {
  it('hold the credential after its scheme too, when a referenced variable holds a header whole', () => {
    const environment = {
      TOOL_SERVERS: JSON.stringify({ graph: { ...graph, headers: { Authorization: '${HEADER}' } } }),
    };

    const { servers } = Effect.runSync(readToolServerSettings({ ...environment, HEADER: `Bearer ${apiKey}` }, context));

    expect(servers[0]?.secrets.map((secret) => Redacted.value(secret))).toEqual([`Bearer ${apiKey}`, apiKey]);
  });

  it('are read from one entry as from the settings file, given the variables it refers to', () => {
    const read = readEntry('graph', { ...graph, headers: { 'X-Api-Key': '${KEY}' } }, { KEY: apiKey }, context);

    expect(read).toMatchObject({ _tag: 'Success', success: { name: 'graph', type: 'mcp' } });
  });
});

describe('the secrets of a server', () => {
  it('refuses a credential written out instead of referenced, and a reference to a variable that is not set, never printing a value', () => {
    const headers = { Authorization: 'Bearer abk_live_9f8e7d6c5b4a', 'X-Tenant': '${GRAPH_TENANT}' };
    const refusal = refusalOf({ graph: { ...graph, headers } });

    expect(refusal.problems).toEqual([
      {
        setting: 'TOOL_SERVERS',
        pointer: '/graph/headers/Authorization',
        detail:
          'Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}',
      },
      {
        setting: 'TOOL_SERVERS',
        pointer: '/graph/headers/X-Tenant',
        detail: 'Refers to the environment variable GRAPH_TENANT, which is not set',
      },
    ]);
    expect(refusal.message).toMatch(
      /^The tool server settings are invalid\. TOOL_SERVERS: \/graph\/headers\/Authorization/u,
    );
    expect(JSON.stringify(refusal)).not.toContain('abk_live');
  });
});
