import { makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CatalogEntry } from '../catalog/catalog-entry.ts';
import { catalogOf, type GenerationCatalog } from '../catalog/generation-catalog.ts';
import { testCatalog, testEntries } from '../testing/test-catalog.ts';
import { defineListGenerationModels } from './list-generation-models.ts';

const reader: CallerIdentity = {
  id: 'acme-reader',
  name: 'acme-reader',
  org: 'acme',
  permissions: ['org:read'],
  playbooks: '*',
};

const writerOnly: CallerIdentity = {
  ...reader,
  id: 'acme-writer',
  name: 'acme-writer',
  permissions: ['playbook:write'],
};

const services = Layer.mergeAll(memoryLedger().layer, memoryPlaybookRegistry([]), recordingReporter().layer);

interface Listing {
  readonly catalog?: GenerationCatalog;
  readonly gateways?: readonly string[];
  readonly caller?: CallerIdentity;
}

async function listGenerationModels(
  input: unknown,
  { catalog = testCatalog, gateways = ['auto'], caller = reader }: Listing = {},
) {
  const { registration } = defineListGenerationModels(catalog, gateways);
  const outcome: Outcome = await Effect.runPromise(
    makeDispatcher([])
      .dispatchToOrg(registration, { caller, org: 'acme', input, encoding: 'strings' })
      .pipe(Effect.provide(services)),
  );
  return { registration, outcome };
}

function outputOf(outcome: Outcome): unknown {
  return outcome.status === 'succeeded' ? outcome.output : undefined;
}

function square(model: string): CatalogEntry {
  return { model, kind: 'image', media_types: [], limits: { aspects: ['1:1'], prompt_characters: 400 } };
}

const sortedEntries = testEntries.toSorted((one, other) => one.model.localeCompare(other.model));

describe('list_generation_models', () => {
  it('is a query of the org at GET /generation-models that anyone who may read the org can call, and reaches nothing outside', async () => {
    const { registration, outcome } = await listGenerationModels({});
    expect(registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'list_generation_models',
      route: { method: 'GET', path: '/generation-models' },
      reachesOutside: false,
    });
    expect(outcome).toMatchObject({ status: 'succeeded' });
    expect((await listGenerationModels({}, { caller: writerOnly })).outcome).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
    });
  });

  it('answers the gateways and every model of the catalogue as its entry says, a retired one with its retirement', async () => {
    const catalog = Result.getOrThrow(catalogOf(sortedEntries));
    const output = outputOf((await listGenerationModels({}, { catalog })).outcome);
    expect(output).toEqual({ object: 'list', gateways: ['auto'], data: catalog.entries });
    expect(output).toMatchObject({
      data: [
        { model: 'example/long-sound' },
        { model: 'example/old-image', retired: { on: '2026-06-30', replacement: 'openai/gpt-image-2' } },
        { model: 'example/short-film' },
        { model: 'example/square-image' },
        { model: 'openai/gpt-4o-mini-tts' },
        { model: 'openai/gpt-image-2' },
      ],
    });
  });

  it('answers only the models of a kind when asked for one, and refuses a kind that is none', async () => {
    const audio = outputOf((await listGenerationModels({ kind: 'audio' })).outcome);
    expect(audio).toMatchObject({ data: [{ model: 'openai/gpt-4o-mini-tts' }, { model: 'example/long-sound' }] });
    expect((await listGenerationModels({ kind: 'text' })).outcome).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/kind' }],
    });
  });
});

describe('the plain words of list_generation_models', () => {
  it('say what a function can name, through which gateways, and which models retired', async () => {
    const { registration, outcome } = await listGenerationModels({}, { gateways: ['auto', 'images'] });
    expect(registration.plainLanguage?.outcome(outputOf(outcome), {})).toBe(
      'A generation function can name 5 models through auto and images: it makes an image with gpt-image-2 or square-image, audio with gpt-4o-mini-tts or long-sound, and a video with short-film. old-image was retired on 2026-06-30; gpt-image-2 replaces it.',
    );
    expect(registration.plainLanguage?.attempt({})).toBe('list the models a generation function may name');
    expect(registration.plainLanguage?.attempt({ kind: 'audio' })).toBe(
      'list the models a generation function may name that makes audio',
    );
  });

  it('say that no function can run where no gateway is configured', async () => {
    const { registration, outcome } = await listGenerationModels({ kind: 'video' }, { gateways: [] });
    expect(registration.plainLanguage?.outcome(outputOf(outcome), { kind: 'video' })).toBe(
      'No model gateway is configured, so no generation function can run until whoever runs the server configures one. A generation function can name 1 model: it makes a video with short-film.',
    );
  });

  it('say whose a model is where two share the last part of their ids', async () => {
    const twins = Result.getOrThrow(catalogOf([square('example/square'), square('other/square')]));
    const { registration, outcome } = await listGenerationModels({}, { catalog: twins });
    expect(registration.plainLanguage?.outcome(outputOf(outcome), {})).toBe(
      'A generation function can name 2 models through auto: it makes an image with square of example or square of other.',
    );
  });

  it('say the catalogue names no model, of a kind or at all', async () => {
    const empty = Result.getOrThrow(catalogOf([]));
    const { registration, outcome } = await listGenerationModels({ kind: 'video' }, { catalog: empty });
    expect(registration.plainLanguage?.outcome(outputOf(outcome), { kind: 'video' })).toBe(
      'The catalogue names no model that makes a video.',
    );
    expect(registration.plainLanguage?.outcome(outputOf(outcome), {})).toBe('The catalogue names no model.');
  });
});

describe('the description of list_generation_models', () => {
  it('says what it lists, how a function names a model, what a retired one is and when to use it', async () => {
    const { registration } = await listGenerationModels({});
    expect(registration.description).toContain('auto/openai/gpt-image-2');
    expect(registration.description).toContain('it is not one to name');
    expect(registration.description.length).toBeLessThan(700);
  });
});
