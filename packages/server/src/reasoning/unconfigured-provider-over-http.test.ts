import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer, type RunningServer } from '../lifecycle/lifecycle.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request, type TestResponse } from '../testing/servers/http-client.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(() => {
  ledger = temporaryLedger();
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

function calling(method: string, path: string, body: object): Promise<TestResponse> {
  return request(server.port, method, path, { body });
}

async function executedVerdict(models: Readonly<Record<string, string>>): Promise<TestResponse> {
  server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      ...noConsentThroughAuto,
      ...models,
    },
    compositionRoot,
  );
  await calling('POST', '/v1/orgs/acme/playbooks', { playbook: 'alpha', name: 'Alpha' });
  await calling('POST', `${alpha}/definitions/reasoning`, { name: 'verdict', source: verdict });
  return calling('POST', `${alpha}/definitions/reasoning/verdict/run`, { input: { expense: 'a dinner' } });
}

describe('a run of a provider the server is not configured for', () => {
  it('answers 503 naming the provider and the providers that are configured, never a setting, without a model call', async () => {
    expect(await executedVerdict({})).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', detail: 'openai is not configured. No model provider is configured' },
    });
  });

  it('names the aliases too, so an agent sees every model reference that works', async () => {
    const throughGateway = {
      MODEL_GATEWAYS: JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]),
      MODEL_ALIASES: JSON.stringify({ 'anthropic/*': 'gateway/anthropic/*' }),
    };

    expect(await executedVerdict(throughGateway)).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: 'openai is not configured. Configured providers: gateway. Aliases: anthropic/*',
      },
    });
  });
});
