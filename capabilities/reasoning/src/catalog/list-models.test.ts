import { makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryPlaybookRegistry, memoryLedger, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicModels, vercelGatewayModels } from '../provider-testing/model-lists.ts';
import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { catalogFor } from '../testing/catalog-harness.ts';
import { defineListModels } from './list-models.ts';

const reader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['org:read'], playbooks: '*' };

const writerOnly: CallerIdentity = { id: 'acme-writer', org: 'acme', permissions: ['playbook:write'], playbooks: '*' };

const environment = {
  ANTHROPIC_API_KEY: 'sk-ant-key',
  MODEL_GATEWAYS: JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]),
  MODEL_ALIASES: JSON.stringify({ 'house/fast': 'gateway/anthropic/claude-haiku-4-5' }),
};

const services = Layer.mergeAll(memoryLedger().layer, memoryPlaybookRegistry([]), recordingReporter().layer);

function outputOf(outcome: Outcome): unknown {
  return outcome.status === 'succeeded' ? outcome.output : undefined;
}

async function listModels(input: unknown, caller: CallerIdentity = reader) {
  const catalog = await catalogFor(environment, ({ url }) =>
    jsonResponse(url.startsWith('https://api.anthropic.com/') ? anthropicModels : vercelGatewayModels),
  );
  const { registration } = defineListModels(catalog.access.catalog);
  const outcome: Outcome = await Effect.runPromise(
    makeDispatcher([])
      .dispatchToOrg(registration, { caller, org: 'acme', input, encoding: 'strings' })
      .pipe(Effect.provide(services)),
  );
  return { registration, outcome };
}

const setup = 'To add one, the person puts a key in the settings of the server.';

async function listedWithSetup(listingEnvironment: Readonly<Record<string, string>>, input: unknown): Promise<unknown> {
  const catalog = await catalogFor(listingEnvironment, () => jsonResponse(anthropicModels));
  const { registration } = defineListModels(catalog.access.catalog, setup);
  return outputOf(
    await Effect.runPromise(
      makeDispatcher([])
        .dispatchToOrg(registration, { caller: reader, org: 'acme', input, encoding: 'strings' })
        .pipe(Effect.provide(services)),
    ),
  );
}

describe('list_models on a server that says how a person adds a model provider', () => {
  it('says it when the server has no model at all', async () => {
    expect(await listedWithSetup({}, {})).toMatchObject({ data: [], provider_setup: setup });
  });

  it('says nothing of it for the models of one provider, or when the server has models', async () => {
    expect(await listedWithSetup({}, { provider: 'mistral' })).not.toHaveProperty('provider_setup');
    expect(await listedWithSetup({ ANTHROPIC_API_KEY: 'sk-ant-key' }, {})).not.toHaveProperty('provider_setup');
  });
});

describe('list_models', () => {
  it('is a query of the org at GET /models that anyone who may read the org can call', async () => {
    const { registration, outcome } = await listModels({});

    expect(registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'list_models',
      route: { method: 'GET', path: '/models' },
      reachesOutside: true,
    });
    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: { object: 'list', catalog_status: 'complete' },
    });
  });
});

describe('the answer of list_models', () => {
  it('answers in the shape of the list of models of the OpenAI API', async () => {
    const { outcome } = await listModels({ provider: 'gateway' });

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: {
        object: 'list',
        data: [
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
      },
    });
  });
});

describe('the plain words of list_models', () => {
  it('says in plain words what it found and what it tried to do', async () => {
    const { registration, outcome } = await listModels({});
    const words = registration.plainLanguage;

    expect(words?.outcome(outputOf(outcome), {})).toBe(
      'This server can call 6 models through anthropic and gateway: Claude Haiku 4.5 (anthropic), Claude Opus 4.1, Claude Sonnet 4.5, Qwen3-14B, Claude Haiku 4.5 (gateway), and fast.',
    );
    expect(words?.attempt({})).toBe('list the models this server can call');
    expect(words?.attempt({ provider: 'gateway' })).toBe('list the models this server can call through gateway');
    expect(words?.attempt({ provider: 'Not A Provider' })).toBe('list the models this server can call');
  });

  it('rejects a provider that is not written as a provider prefix, and a caller who may not read the org', async () => {
    expect((await listModels({ provider: 'Gateway/' })).outcome).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/provider' }],
    });
    expect((await listModels({}, writerOnly)).outcome).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});

describe('the description of list_models', () => {
  it('says what a model id is, which entries are not models to run, and when to use it', async () => {
    const { registration } = await listModels({});

    expect(registration.description).toBe(
      [
        'Lists the models this server can call, by the id a reasoning function gives as its model, written provider/model.',
        'An id ending in * stands for any model of its provider and is not one to run.',
        'Use it before a reasoning function names its model, or when a run says its model is not offered.',
      ].join(' '),
    );
  });
});
