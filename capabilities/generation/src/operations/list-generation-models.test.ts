import { makeDispatcher, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Clock, Effect, Layer, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CatalogEntry } from '../catalog/catalog-entry.ts';
import { generationShippedRoots, readGenerationCatalog } from '../catalog/catalog-reading.ts';
import { catalogOf, type GenerationCatalog } from '../catalog/generation-catalog.ts';
import { clockAt, testCatalog, testEntries } from '../testing/index.ts';
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

const playbookReader: CallerIdentity = {
  ...reader,
  id: 'acme-playbook-reader',
  name: 'acme-playbook-reader',
  permissions: ['playbook:read'],
};

const listedOn = Date.parse('2026-11-16T09:00:00Z');

function servicesAt(now: number) {
  return Layer.mergeAll(
    memoryLedger().layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    recordingReporter().layer,
    Layer.succeed(
      Clock.Clock,
      clockAt(() => now),
    ),
  );
}

const services = servicesAt(listedOn);

interface Listing {
  readonly catalog?: GenerationCatalog;
  readonly gateways?: readonly string[];
  readonly caller?: CallerIdentity;
  readonly now?: number;
}

async function listGenerationModels(
  input: unknown,
  { catalog = testCatalog, gateways = ['auto'], caller = reader, now = listedOn }: Listing = {},
) {
  const { registration } = defineListGenerationModels(catalog, gateways).org;
  const outcome: Outcome = await Effect.runPromise(
    makeDispatcher([])
      .dispatchToOrg(registration, { caller, org: 'acme', input, encoding: 'strings' })
      .pipe(Effect.provide(servicesAt(now))),
  );
  return { registration, outcome };
}

async function listGenerationModelsInAPlaybook(input: unknown, caller: CallerIdentity) {
  const { registration } = defineListGenerationModels(testCatalog, ['auto']).playbook;
  const outcome: Outcome = await Effect.runPromise(
    makeDispatcher([])
      .dispatchToPlaybook(registration, { caller, org: 'acme', playbook: 'alpha', input, encoding: 'strings' })
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
    expect(output).toEqual({ object: 'list', as_of: '2026-11-16', gateways: ['auto'], data: catalog.entries });
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

describe('list_generation_models of a playbook', () => {
  it('is the same in every scope: a query of a playbook too, at the same route, that anyone who may read the playbook can call, answering what the org query answers', async () => {
    const inThePlaybook = await listGenerationModelsInAPlaybook({ kind: 'image' }, playbookReader);
    const inTheOrg = await listGenerationModels({ kind: 'image' });
    expect(inThePlaybook.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'list_generation_models',
      route: { method: 'GET', path: '/generation-models' },
      permissions: ['playbook:read'],
      sameInEveryScope: true,
      reachesOutside: false,
    });
    expect(inTheOrg.registration).toMatchObject({ permissions: ['org:read'], sameInEveryScope: true });
    expect(inThePlaybook.outcome).toEqual(inTheOrg.outcome);
    expect((await listGenerationModelsInAPlaybook({}, reader)).outcome).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller lacks the playbook:read permission',
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

  it('say, of the catalogue the runtime ships and one gateway, what the MCP reference gives', async () => {
    const shipped = Result.getOrThrow(await readGenerationCatalog(shippedFilesOnDisk(generationShippedRoots())));
    const { registration, outcome } = await listGenerationModels({}, { catalog: shipped, gateways: ['gateway'] });
    expect(registration.plainLanguage?.outcome(outputOf(outcome), {})).toBe(
      'A generation function can name 14 models through gateway: it makes an image with gpt-image-2, gpt-image-2.6-flare, gpt-image-2.6-sunburst, gemini-3-pro-image, gemini-nano-banana-2.1, or grok-imagine-image-2.0, audio with gpt-4o-mini-tts, tts-1, tts-1-hd, gemini-3.8-flash-lite-tts, or gemini-3.8-flash-tts, and a video with veo-3.1-fast-generate-001, veo-3.1-generate-001, or veo-3.1-lite-generate-001. gpt-4o-mini-tts retires on 2027-01-06; name gemini-3.8-flash-tts before then. tts-1 retires on 2027-01-06; name gemini-3.8-flash-lite-tts before then. tts-1-hd retires on 2027-01-06; name gemini-3.8-flash-tts before then.',
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
    expect(registration.description).toContain('is refused from that day');
    expect(registration.description.length).toBeLessThan(700);
  });
});

async function audioWordsOn(day: string): Promise<string | undefined> {
  const shipped = Result.getOrThrow(await readGenerationCatalog(shippedFilesOnDisk(generationShippedRoots())));
  const { registration, outcome } = await listGenerationModels(
    { kind: 'audio' },
    { catalog: shipped, gateways: ['gateway'], now: Date.parse(day) },
  );
  return registration.plainLanguage?.outcome(outputOf(outcome), { kind: 'audio' });
}

describe('the plain words of list_generation_models about the speech models OpenAI retires', () => {
  it('say, from the day OpenAI retires them, that they were retired and leave them out of what a function can name', async () => {
    expect([await audioWordsOn('2027-01-05T23:59:59Z'), await audioWordsOn('2027-01-06T00:00:00Z')]).toEqual([
      'A generation function can name 5 models through gateway: it makes audio with gpt-4o-mini-tts, tts-1, tts-1-hd, gemini-3.8-flash-lite-tts, or gemini-3.8-flash-tts. gpt-4o-mini-tts retires on 2027-01-06; name gemini-3.8-flash-tts before then. tts-1 retires on 2027-01-06; name gemini-3.8-flash-lite-tts before then. tts-1-hd retires on 2027-01-06; name gemini-3.8-flash-tts before then.',
      'A generation function can name 2 models through gateway: it makes audio with gemini-3.8-flash-lite-tts or gemini-3.8-flash-tts. gpt-4o-mini-tts was retired on 2027-01-06; gemini-3.8-flash-tts replaces it. tts-1 was retired on 2027-01-06; gemini-3.8-flash-lite-tts replaces it. tts-1-hd was retired on 2027-01-06; gemini-3.8-flash-tts replaces it.',
    ]);
  });
});
