import { listedTools, plainTextIn, technicalTextIn, type ToolResult, withMcpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { makeModelAccess } from '@on.auto/reasoning';
import { anthropicModels, jsonResponse, recordingFetch, vercelGatewayModels } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { startServer } from '../lifecycle/lifecycle.ts';
import type { RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request } from '../testing/servers/http-client.ts';
import {
  alpha,
  loopbackSettingsOver,
  type ReasoningServer,
  servingReasoning,
} from '../testing/servers/reasoning-server.ts';
import { testComposition } from '../testing/servers/test-compositions.ts';

const environment = {
  ANTHROPIC_API_KEY: 'sk-ant-SECRET-key-0001',
  MODEL_GATEWAYS: JSON.stringify([
    {
      name: 'gateway',
      base_url: 'https://llm.internal.example/v1',
      api_key_env: 'GATEWAY_KEY',
      headers: { 'x-tenant': 'acme-tenant-SECRET' },
    },
  ]),
  GATEWAY_KEY: 'gateway-SECRET-key-0002',
  MODEL_ALIASES: JSON.stringify({ 'house/fast': 'gateway/anthropic/claude-haiku-4-5' }),
};

const sensitive = ['SECRET', 'internal.example', 'x-tenant', 'pricing', 'regions', 'eu-central-1', 'description'];

const listedModels = {
  object: 'list',
  data: [
    {
      id: 'anthropic/claude-haiku-4-5-20251001',
      object: 'model',
      created: 1_759_276_800,
      owned_by: 'anthropic',
      name: 'Claude Haiku 4.5',
      context_window: 200_000,
      max_tokens: 64_000,
    },
    {
      id: 'anthropic/claude-opus-4-1-20250805',
      object: 'model',
      created: 1_754_352_000,
      owned_by: 'anthropic',
      name: 'Claude Opus 4.1',
    },
    {
      id: 'anthropic/claude-sonnet-4-5-20250929',
      object: 'model',
      created: 1_759_104_000,
      owned_by: 'anthropic',
      name: 'Claude Sonnet 4.5',
      context_window: 200_000,
      max_tokens: 64_000,
    },
    {
      id: 'gateway/alibaba/qwen-3-14b',
      object: 'model',
      created: 1_755_815_280,
      owned_by: 'gateway',
      name: 'Qwen3-14B',
      context_window: 40_960,
      max_tokens: 16_384,
    },
    {
      id: 'gateway/anthropic/claude-haiku-4-5',
      object: 'model',
      created: 1_760_486_400,
      owned_by: 'gateway',
      name: 'Claude Haiku 4.5',
      context_window: 200_000,
      max_tokens: 64_000,
    },
    {
      id: 'house/fast',
      object: 'model',
      created: 0,
      owned_by: 'gateway',
      alias: true,
      resolved_to: 'gateway/anthropic/claude-haiku-4-5',
    },
  ],
  catalog_status: 'complete',
  narrowed: false,
};

const allowing = {
  ...environment,
  ALLOWED_MODELS: JSON.stringify(['anthropic/claude-sonnet-4-5-20250929', 'house/fast']),
};

const plainWords =
  'This server can call 6 models through anthropic and gateway: Claude Haiku 4.5 (anthropic), Claude Opus 4.1, Claude Sonnet 4.5, Qwen3-14B, Claude Haiku 4.5 (gateway), and fast.';

let server: ReasoningServer;

function providerLists() {
  return recordingFetch(({ url }) =>
    jsonResponse(url.startsWith('https://api.anthropic.com/') ? anthropicModels : vercelGatewayModels),
  );
}

function listedOnMcp(path: string, input: Readonly<Record<string, unknown>> = {}): Promise<ToolResult> {
  return withMcpSession('current revision', { url: `${server.origin}${path}`, headers: {} }, (session) =>
    session.callTool('list_models', input),
  );
}

function leaksIn(...texts: readonly string[]): readonly string[] {
  return sensitive.filter((term) => texts.some((text) => text.includes(term)));
}

const greeting = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Say hello.'].join('\n');

function listingNothing(): Promise<Response> {
  return Promise.resolve(jsonResponse({ data: [], has_more: false }));
}

function servingCounted(composing: () => void): Promise<RunningServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return startServer(
    { ...loopbackSettingsOver(ledger), ANTHROPIC_API_KEY: 'sk-ant-test-key' },
    testComposition({
      goals: false,
      modelAccessOf: (settings) =>
        Effect.suspend(() => {
          composing();
          return makeModelAccess(settings, { fetch: listingNothing });
        }),
    }),
  );
}

describe('listed models', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('list_models over HTTP', () => {
    it('answers GET /v1/orgs/{org}/models with the models of every provider, read once with the server’s keys', async () => {
      const lists = providerLists();
      server = await servingReasoning([], environment, lists.fetch);

      const listed = await server.call('GET', '/v1/orgs/local/models');
      const again = await server.call('GET', '/v1/orgs/local/models');

      expect(listed).toMatchObject({ status: 200, body: listedModels });
      expect(listed.headers.get('cache-control')).toBe('no-store');
      expect(again.body).toEqual(listed.body);
      expect(lists.requests().map(({ url, headers }) => [url, headers['x-api-key'], headers['authorization']])).toEqual(
        [
          ['https://api.anthropic.com/v1/models?limit=1000', 'sk-ant-SECRET-key-0001', undefined],
          ['https://llm.internal.example/v1/models', undefined, 'Bearer gateway-SECRET-key-0002'],
        ],
      );
      expect(leaksIn(listed.text)).toEqual([]);
    });

    it('lists the models of one provider when the query names it', async () => {
      server = await servingReasoning([], environment, providerLists().fetch);

      const listed = await server.call('GET', '/v1/orgs/local/models?provider=anthropic');

      expect(listed).toMatchObject({ status: 200, body: { data: listedModels.data.slice(0, 3) } });
    });

    it('says the list is partial when a provider cannot be reached, and lists what it can', async () => {
      server = await servingReasoning([], environment);

      const listed = await server.call('GET', '/v1/orgs/local/models');

      expect(listed).toMatchObject({ status: 200, body: { data: [listedModels.data[5]], catalog_status: 'partial' } });
    });
  });

  describe('list_models over MCP', () => {
    it('answers on /mcp and on the endpoint of the org with the same list, led by plain words that leak nothing', async () => {
      server = await servingReasoning([], environment, providerLists().fetch);
      const tools = await withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, (session) =>
        session.listTools(),
      );

      const own = await listedOnMcp('/mcp');
      const org = await listedOnMcp('/orgs/local/mcp');

      expect(own.structuredContent).toMatchObject(listedModels);
      expect(org.structuredContent).toEqual(own.structuredContent);
      expect(listedTools(tools).find(({ name }) => name === 'list_models')?.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: true,
      });
      expect(plainTextIn(own)).toBe(plainWords);
      expect(internalTermsIn(plainTextIn(own))).toEqual([]);
      expect(leaksIn(plainTextIn(own), technicalTextIn(own))).toEqual([]);
    });

    it('says plainly that the list may be incomplete when a provider cannot be reached', async () => {
      server = await servingReasoning([], environment);

      const listed = await listedOnMcp('/mcp');

      expect(plainTextIn(listed)).toBe(
        'This server can call 1 model through gateway: fast. The list may be incomplete: a provider could not be asked just now.',
      );
    });

    it('refuses a provider written as anything but a provider prefix, in plain words', async () => {
      server = await servingReasoning([], environment, providerLists().fetch);

      const refused = await listedOnMcp('/mcp', { provider: 'Not/A Provider' });

      expect(refused.isError).toBe(true);
      expect(plainTextIn(refused)).toBe(
        'Could not list the models this server can call: what was given does not fit what it needs. This can be corrected and tried again; the details below say what to change.',
      );
    });
  });

  describe('list_models when the operator allows only some models', () => {
    it('lists only those over HTTP, and says the list is narrowed', async () => {
      server = await servingReasoning([], allowing, providerLists().fetch);

      const listed = await server.call('GET', '/v1/orgs/local/models');

      expect(listed).toMatchObject({
        status: 200,
        body: { data: [listedModels.data[2], listedModels.data[5]], catalog_status: 'complete', narrowed: true },
      });
    });

    it('lists the same over MCP, and says plainly that the list holds only what the operator allows', async () => {
      server = await servingReasoning([], allowing, providerLists().fetch);

      const listed = await listedOnMcp('/mcp');

      expect(listed.structuredContent).toMatchObject({
        data: [listedModels.data[2], listedModels.data[5]],
        catalog_status: 'complete',
        narrowed: true,
      });
      expect(plainTextIn(listed)).toBe(
        'This server can call 2 models through anthropic and gateway: Claude Sonnet 4.5 and fast. It lists only the models its operator allows.',
      );
      expect(internalTermsIn(plainTextIn(listed))).toEqual([]);
    });
  });
});

describe('the models reasoning functions call', () => {
  it('are composed when a request first needs them, not at the start nor for a definition saved, and kept', async () => {
    const composings = { count: 0 };
    const serverModelsFirstUse = await servingCounted(() => {
      composings.count += 1;
    });
    const atStart = composings.count;
    await request(serverModelsFirstUse.port, 'POST', '/v1/orgs/acme/playbooks', {
      body: { playbook: 'alpha', name: 'Alpha' },
    });
    await request(serverModelsFirstUse.port, 'POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'hello', source: greeting, diagram: 'none' },
    });
    const afterTheSave = composings.count;

    const listed = [
      await request(serverModelsFirstUse.port, 'GET', '/v1/orgs/acme/models'),
      await request(serverModelsFirstUse.port, 'GET', '/v1/orgs/acme/models'),
    ];
    await serverModelsFirstUse.stop();

    expect({ atStart, afterTheSave, listed: listed.map(({ status }) => status), composed: composings.count }).toEqual({
      atStart: 0,
      afterTheSave: 0,
      listed: [200, 200],
      composed: 1,
    });
  });
});
