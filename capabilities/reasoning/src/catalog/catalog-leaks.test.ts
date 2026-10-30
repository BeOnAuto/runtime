import { describe, expect, it } from 'vitest';

import { anthropicModels, liteLlmModels, openAiModels, vercelGatewayModels } from '../provider-testing/model-lists.ts';
import { gatewayError, gatewayInternals } from '../provider-testing/provider-errors.ts';
import { jsonResponse, type Responder } from '../provider-testing/recording-fetch.ts';
import { catalogFor } from '../testing/catalog-harness.ts';
import { modelsListed } from './catalog-words.ts';

const environment = {
  ANTHROPIC_API_KEY: 'sk-ant-SECRET-key-0001',
  ANTHROPIC_BASE_URL: 'https://anthropic-proxy.internal.example/v1',
  OPENAI_API_KEY: 'sk-openai-SECRET-key-0002',
  GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-google-SECRET-key-0003',
  AWS_REGION: 'eu-central-1',
  GOOGLE_VERTEX_PROJECT: 'acme-vertex-project',
  GOOGLE_VERTEX_LOCATION: 'europe-west4',
  MODEL_GATEWAYS: JSON.stringify([
    {
      name: 'gateway',
      base_url: 'https://llm.internal.example/v1',
      api_key_env: 'GATEWAY_KEY',
      headers: { 'x-tenant': 'acme-tenant-SECRET' },
      query_params: { 'api-version': 'query-SECRET-0004' },
    },
    { name: 'proxy', base_url: 'https://proxy.internal.example/v1' },
  ]),
  GATEWAY_KEY: 'gateway-SECRET-key-0005',
  MODEL_ALIASES: JSON.stringify({
    'house/claims': 'bedrock-anthropic/arn:aws:bedrock:eu-central-1:123456789012:application-inference-profile/a1b2c3',
  }),
};

const sensitive = [
  'SECRET',
  'internal.example',
  'x-tenant',
  'api-version',
  'eu-central-1',
  '123456789012',
  'acme-vertex-project',
  'europe-west4',
  'pricing',
  '0.000001',
  'regions',
  'zdr',
  'tags',
  'performance',
  'system',
  'openai-internal',
  'user-a1b2c3d4e5',
  'acme-corp',
  ...gatewayInternals,
];

const everyKindOfAnswer: Responder = ({ url }) => {
  if (url.startsWith('https://anthropic-proxy.internal.example/')) {
    return jsonResponse(anthropicModels);
  }
  if (url.startsWith('https://api.openai.com/')) {
    return jsonResponse(openAiModels);
  }
  if (url.startsWith('https://proxy.internal.example/')) {
    return jsonResponse(liteLlmModels);
  }
  return url.startsWith('https://llm.internal.example/')
    ? jsonResponse(vercelGatewayModels)
    : jsonResponse(gatewayError, 500);
};

describe('the list of models and its plain words', () => {
  it('carry no key, base URL, header, query parameter, account, region, upstream error, price or owner', async () => {
    const catalog = await catalogFor(environment, everyKindOfAnswer);

    const list = await catalog.list();
    const shown = `${JSON.stringify(list)}\n${modelsListed(list)}`;

    expect(list.catalog_status).toBe('partial');
    expect(sensitive.filter((term) => shown.includes(term))).toEqual([]);
    expect(new Set(list.data.map(({ owned_by: ownedBy }) => ownedBy))).toEqual(
      new Set([
        'anthropic',
        'openai',
        'bedrock',
        'bedrock-anthropic',
        'vertex',
        'vertex-anthropic',
        'gateway',
        'proxy',
      ]),
    );
    expect(JSON.stringify(catalog.reports())).toContain('litellm.NotFoundError');
  });
});
