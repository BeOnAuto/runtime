import { describe, expect, it } from 'vitest';

import type { ModelFailure } from '../failure/model-failure.ts';
import {
  gatewayError,
  gatewayErrorText,
  gatewayInternals,
  recordingReporter,
} from '../provider-testing/provider-errors.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, promptText, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';
import type { ProviderMessageReport } from './model-access-options.ts';

const apiKey = 'sk-openai-SECRET-5d2f';

const internalText = 'internal route eu-1 to pool-7 is closed';

interface Outcome {
  readonly failure: ModelFailure;
  readonly reports: readonly ProviderMessageReport[];
}

function openAiError(message: string): object {
  return { error: { message, type: 'invalid_request_error', param: null, code: null } };
}

function staticAwsCredentials() {
  return Promise.resolve({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' });
}

async function outcomeOf(
  environment: Readonly<Record<string, string>>,
  model: string,
  response: () => Response,
): Promise<Outcome> {
  const reporter = recordingReporter();
  const recording = recordingFetch(response);
  const access = await accessFor(environment, {
    fetch: recording.fetch,
    credentials: { aws: staticAwsCredentials },
    reportProviderMessage: reporter.report,
  });
  const failure = await failed(access, textRequest(model, { run_id: 'exec-1' }));
  expect(exposedText(failure)).not.toContain(promptText);
  return { failure, reports: reporter.reports() };
}

describe('the message of a built-in provider at its default endpoint', () => {
  it('reaches the caller as its first line, and the operator whole', async () => {
    const { failure, reports } = await outcomeOf({ OPENAI_API_KEY: apiKey }, 'openai/gpt-5', () =>
      jsonResponse(openAiError('Unsupported parameter: temperature\nSee the documentation'), 400),
    );

    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      detail: 'openai answered HTTP 400: the request was rejected as invalid',
      provider_message: 'Unsupported parameter: temperature',
    });
    expect(reports).toEqual([
      {
        provider: 'openai',
        model: 'openai/gpt-5',
        status: 400,
        message: 'Unsupported parameter: temperature\nSee the documentation',
        run_id: 'exec-1',
      },
    ]);
  });

  it('reaches the caller as its first line, however much space that line holds', async () => {
    const spaced = `Unsupported${' '.repeat(100_000)}parameter`;
    const { failure } = await outcomeOf({ OPENAI_API_KEY: apiKey }, 'openai/gpt-5', () =>
      jsonResponse(openAiError(`${spaced}\nSee the documentation`), 400),
    );

    expect(failure).toMatchObject({ provider_message: spaced.slice(0, 300) });
  });

  it('reaches the caller with at most 300 characters, and the operator with at most 2000', async () => {
    const { failure, reports } = await outcomeOf({ OPENAI_API_KEY: apiKey }, 'openai/gpt-5', () =>
      jsonResponse(openAiError('x'.repeat(3000)), 422),
    );

    expect(failure).toMatchObject({ provider_message: 'x'.repeat(300) });
    expect(reports.map(({ message }) => message)).toEqual(['x'.repeat(2000)]);
  });

  it('never carries a secret of the settings, to the caller or to the operator', async () => {
    const { failure, reports } = await outcomeOf({ OPENAI_API_KEY: apiKey }, 'openai/gpt-5', () =>
      jsonResponse(openAiError(`The key ${apiKey} may not use this model`), 404),
    );

    expect(failure).toMatchObject({ provider_message: 'The key [redacted] may not use this model' });
    expect(exposedText(failure)).not.toContain(apiKey);
    expect(exposedText(reports)).not.toContain(apiKey);
  });
});

describe('the message of a provider that quotes the prompt', () => {
  it('carries a placeholder in place of the prompt, to the caller and to the operator', async () => {
    const { failure, reports } = await outcomeOf({ OPENAI_API_KEY: apiKey }, 'openai/gpt-5', () =>
      jsonResponse(openAiError(`Answer briefly: '${promptText}' is too long`), 400),
    );

    expect(failure).toMatchObject({ provider_message: "[prompt]: '[prompt]' is too long" });
    expect(reports.map(({ message }) => message)).toEqual(["[prompt]: '[prompt]' is too long"]);
  });

  it('carries a placeholder when the request has no instructions', async () => {
    const reporter = recordingReporter();
    const access = await accessFor(
      { OPENAI_API_KEY: apiKey },
      {
        fetch: recordingFetch(() => jsonResponse(openAiError(`Cannot read ${promptText}`), 400)).fetch,
        reportProviderMessage: reporter.report,
      },
    );
    const { instructions: _instructions, ...withoutInstructions } = textRequest('openai/gpt-5');

    expect(await failed(access, withoutInstructions)).toMatchObject({ provider_message: 'Cannot read [prompt]' });
  });
});

describe('the message of Azure addressed by its resource name', () => {
  it('reaches the caller, as Azure answers at its own endpoint', async () => {
    const { failure } = await outcomeOf(
      { AZURE_RESOURCE_NAME: 'acme-openai', AZURE_API_KEY: 'azure-key' },
      'azure/gpt-5-production',
      () => jsonResponse(openAiError('The deployment does not exist'), 404),
    );

    expect(failure).toMatchObject({ provider_message: 'The deployment does not exist' });
  });
});

interface Overridden {
  readonly name: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly model: string;
  readonly response: () => Response;
}

const overridden: readonly Overridden[] = [
  {
    name: 'OpenAI at OPENAI_BASE_URL',
    environment: { OPENAI_API_KEY: apiKey, OPENAI_BASE_URL: 'https://llm.internal.example/v1' },
    model: 'openai/gpt-5',
    response: () => jsonResponse(openAiError(internalText), 404),
  },
  {
    name: 'Anthropic at ANTHROPIC_BASE_URL',
    environment: { ANTHROPIC_API_KEY: 'sk-ant-key', ANTHROPIC_BASE_URL: 'https://llm.internal.example/anthropic' },
    model: 'anthropic/claude-sonnet-4-5',
    response: () => jsonResponse({ type: 'error', error: { type: 'not_found_error', message: internalText } }, 404),
  },
  {
    name: 'Azure at AZURE_BASE_URL',
    environment: { AZURE_BASE_URL: 'https://apim.internal.example/openai', AZURE_API_KEY: 'azure-key' },
    model: 'azure/gpt-5-production',
    response: () => jsonResponse(openAiError(internalText), 404),
  },
  {
    name: 'Bedrock at AWS_ENDPOINT_URL_BEDROCK_RUNTIME',
    environment: { AWS_REGION: 'eu-west-1', AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://bedrock.internal.example' },
    model: 'bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    response: () => jsonResponse({ message: internalText }, 404),
  },
];

describe('the message of a built-in provider at an endpoint the operator overrode', () => {
  it.each(overridden)('reaches only the operator: $name', async ({ environment, model, response }) => {
    const { failure, reports } = await outcomeOf(environment, model, response);
    const [provider] = model.split('/');

    expect(failure).toMatchObject({ _tag: 'definition_invalid', provider, status: 404, provider_message: null });
    expect(failure).toMatchObject({ detail: `${String(provider)} answered HTTP 404: the model was not found` });
    expect(exposedText(failure)).not.toContain(internalText);
    expect(reports).toMatchObject([{ status: 404, message: internalText, model }]);
  });
});

const gateway = { name: 'gateway', base_url: 'https://llm.internal.example/v1' };

describe('the message of a gateway', () => {
  it('reaches only the operator by default', async () => {
    const { failure, reports } = await outcomeOf(
      { MODEL_GATEWAYS: JSON.stringify([gateway]) },
      'gateway/no-such-model-xyz',
      () => jsonResponse(gatewayError, 404),
    );

    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      provider: 'gateway',
      status: 404,
      detail: 'gateway answered HTTP 404: the model was not found, with the error code 404',
      provider_message: null,
    });
    expect(gatewayInternals.filter((internal) => exposedText(failure).includes(internal))).toEqual([]);
    expect(reports).toEqual([
      {
        provider: 'gateway',
        model: 'gateway/no-such-model-xyz',
        status: 404,
        message: gatewayErrorText,
        run_id: 'exec-1',
      },
    ]);
  });

  it('reaches the caller too when the gateway is set to expose its messages', async () => {
    const { failure } = await outcomeOf(
      { MODEL_GATEWAYS: JSON.stringify([{ ...gateway, expose_provider_messages: true }]) },
      'gateway/no-such-model-xyz',
      () => jsonResponse(gatewayError, 404),
    );

    expect(failure).toMatchObject({ provider_message: gatewayErrorText.slice(0, 300) });
  });
});

describe('the message of any call that fails at the provider', () => {
  it.each([429, 503, 401])('reaches the operator, and never the caller, on HTTP %i', async (status) => {
    const { failure, reports } = await outcomeOf({ OPENAI_API_KEY: apiKey }, 'openai/gpt-5', () =>
      jsonResponse(openAiError(internalText), status),
    );

    expect(exposedText(failure)).not.toContain(internalText);
    expect(reports).toMatchObject([{ status, message: internalText }]);
  });

  it('is not reported when the provider gives none', async () => {
    const { reports } = await outcomeOf({ OPENAI_API_KEY: apiKey }, 'openai/gpt-5', () =>
      jsonResponse(openAiError(' '), 400),
    );

    expect(reports).toEqual([]);
  });
});
