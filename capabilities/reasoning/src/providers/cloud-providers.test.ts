import { describe, expect, it } from 'vitest';

import {
  anthropicMessage,
  converseMessage,
  converseToolAnswer,
  geminiContent,
} from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, jsonRequest, succeeded, textRequest } from '../testing/adapter-harness.ts';
import type { AwsCredentials } from './credential-sources.ts';

const region = { AWS_REGION: 'eu-west-1' };

const vertex = { GOOGLE_VERTEX_PROJECT: 'acme-ai', GOOGLE_VERTEX_LOCATION: 'europe-west4' };

function countingAws() {
  let lookups = 0;
  return {
    lookups: () => lookups,
    source: (): Promise<AwsCredentials> => {
      lookups += 1;
      return Promise.resolve({
        accessKeyId: `AKIDEXAMPLE${lookups}`,
        secretAccessKey: 'secret',
        sessionToken: `session-${lookups}`,
      });
    },
  };
}

function countingTokens() {
  let lookups = 0;
  return {
    lookups: () => lookups,
    source: (): Promise<string> => {
      lookups += 1;
      return Promise.resolve(`ya29-${lookups}`);
    },
  };
}

describe('the bedrock provider', () => {
  it('signs every request with credentials looked up for that request', async () => {
    const recording = recordingFetch(() =>
      jsonResponse(converseMessage('Hello'), 200, { 'x-amzn-requestid': 'request-7' }),
    );
    const aws = countingAws();
    const access = await accessFor(region, { fetch: recording.fetch, credentials: { aws: aws.source } });

    const first = await succeeded(access, textRequest('bedrock/amazon.nova-pro-v1:0'));
    await succeeded(access, textRequest('bedrock/amazon.nova-pro-v1:0'));

    const [one, two] = recording.requests();
    expect(aws.lookups()).toBe(2);
    expect(one?.url).toBe('https://bedrock-runtime.eu-west-1.amazonaws.com/model/amazon.nova-pro-v1%3A0/converse');
    expect(one?.headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE1\/\d{8}\/eu-west-1\/bedrock\//u,
    );
    expect(two?.headers['x-amz-security-token']).toBe('session-2');
    expect(one?.body).toMatchObject({ inferenceConfig: { maxTokens: 256 } });
    expect(first).toMatchObject({
      response_id: 'request-7',
      usage: { input: { total: 26, uncached: 18, cache_read: 6, cache_write: 2 }, output: { total: 7 }, total: 33 },
    });
  });

  it('answers JSON through a tool for models without native structured output', async () => {
    const recording = recordingFetch(() => jsonResponse(converseToolAnswer({ verdict: 'approve' })));
    const access = await accessFor(region, { fetch: recording.fetch, credentials: { aws: countingAws().source } });

    const result = await succeeded(access, jsonRequest('bedrock/amazon.nova-pro-v1:0'));

    expect(recording.requests()[0]?.body).toMatchObject({
      toolConfig: { tools: [{ toolSpec: { name: 'json' } }], toolChoice: { any: {} } },
    });
    expect(result.json).toEqual({ verdict: 'approve' });
  });
});

describe('the bedrock provider with an API key and a private endpoint', () => {
  it('uses the bearer token and the endpoint variable when they are set', async () => {
    const recording = recordingFetch(() => jsonResponse(converseMessage('Hello')));
    const aws = countingAws();
    const environment = {
      ...region,
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-api-key',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://vpce-1.bedrock-runtime.eu-west-1.vpce.amazonaws.com',
    };
    const access = await accessFor(environment, { fetch: recording.fetch, credentials: { aws: aws.source } });

    await succeeded(access, textRequest('bedrock/amazon.nova-pro-v1:0'));

    const [request] = recording.requests();
    expect(request?.url).toBe(
      'https://vpce-1.bedrock-runtime.eu-west-1.vpce.amazonaws.com/model/amazon.nova-pro-v1%3A0/converse',
    );
    expect(request?.headers['authorization']).toBe('Bearer bedrock-api-key');
    expect(aws.lookups()).toBe(0);
  });
});

describe('the bedrock-anthropic provider', () => {
  it('calls InvokeModel with the Anthropic Messages body and native structured output', async () => {
    const recording = recordingFetch(() => jsonResponse(anthropicMessage('{"verdict":"approve"}')));
    const access = await accessFor(region, { fetch: recording.fetch, credentials: { aws: countingAws().source } });

    const result = await succeeded(
      access,
      jsonRequest('bedrock-anthropic/eu.anthropic.claude-sonnet-4-5-20250929-v1:0'),
    );

    expect(recording.requests()[0]).toMatchObject({
      url: 'https://bedrock-runtime.eu-west-1.amazonaws.com/model/eu.anthropic.claude-sonnet-4-5-20250929-v1%3A0/invoke',
      body: {
        max_tokens: 256,
        anthropic_version: 'bedrock-2023-05-31',
        output_config: { format: { type: 'json_schema' } },
      },
    });
    expect(result.json).toEqual({ verdict: 'approve' });
  });
});

describe('the vertex provider', () => {
  it('sends a fresh access token on every Gemini request', async () => {
    const recording = recordingFetch(() => jsonResponse(geminiContent('Hello')));
    const google = countingTokens();
    const access = await accessFor(vertex, { fetch: recording.fetch, credentials: { google: google.source } });

    await succeeded(access, textRequest('vertex/gemini-2.5-flash'));
    await succeeded(access, textRequest('vertex/gemini-2.5-flash'));

    const [one, two] = recording.requests();
    expect(google.lookups()).toBe(2);
    expect(one?.url).toBe(
      'https://europe-west4-aiplatform.googleapis.com/v1beta1/projects/acme-ai/locations/europe-west4/publishers/google/models/gemini-2.5-flash:generateContent',
    );
    expect([one?.headers['authorization'], two?.headers['authorization']]).toEqual(['Bearer ya29-1', 'Bearer ya29-2']);
  });
});

describe('the vertex-anthropic provider', () => {
  it('looks the access token up twice for every Claude request, because the model resolves its headers twice', async () => {
    const recording = recordingFetch(() => jsonResponse(anthropicMessage('Hello')));
    const google = countingTokens();
    const access = await accessFor(vertex, { fetch: recording.fetch, credentials: { google: google.source } });

    await succeeded(access, textRequest('vertex-anthropic/claude-sonnet-4-5'));
    await succeeded(access, textRequest('vertex-anthropic/claude-sonnet-4-5'));

    const [one, two] = recording.requests();
    expect(one?.url).toBe(
      'https://europe-west4-aiplatform.googleapis.com/v1/projects/acme-ai/locations/europe-west4/publishers/anthropic/models/claude-sonnet-4-5:rawPredict',
    );
    expect(google.lookups()).toBe(4);
    expect([one?.headers['authorization'], two?.headers['authorization']]).toEqual(['Bearer ya29-2', 'Bearer ya29-4']);
    expect(one?.body).toMatchObject({ max_tokens: 256, anthropic_version: 'vertex-2023-10-16' });
  });
});
