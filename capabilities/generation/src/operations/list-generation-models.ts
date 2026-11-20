import { defineQuery } from '@on.auto/operations';
import { alternatives, counted, listed, type Noun } from '@on.auto/phrasing';
import { Clock, Effect, Schema } from 'effect';

import { dayOf, GenerationKindSchema, type GenerationKind } from '../catalog/catalog-entry.ts';
import type { GenerationCatalog } from '../catalog/generation-catalog.ts';

const task = 'list the models a generation function may name';

const description = [
  "Lists the models a generation function may name, from this server's catalogue, with what each produces and takes, and the gateways a function names a model through.",
  'A function names its model as gateway/model, such as auto/openai/gpt-image-2.',
  'A retired model may be named until its retired.on and is refused from that day.',
  'Use it before a generation function names its model or its parameters.',
].join(' ');

const InputSchema = Schema.Struct({
  kind: Schema.optionalKey(
    GenerationKindSchema.annotate({
      description: 'Lists only the models that produce this kind: image, audio or video',
    }),
  ),
});

const ValuesSchema = Schema.Array(Schema.String);

const ListedEntrySchema = Schema.Struct({
  model: Schema.String,
  name: Schema.optionalKey(Schema.String.annotate({ description: 'The name the provider gives the model' })),
  kind: GenerationKindSchema,
  media_types: ValuesSchema.annotate({ description: 'The media types of the assets it takes as references' }),
  limits: Schema.Struct({
    sizes: Schema.optionalKey(ValuesSchema),
    aspects: Schema.optionalKey(ValuesSchema),
    qualities: Schema.optionalKey(ValuesSchema),
    voices: Schema.optionalKey(ValuesSchema),
    formats: Schema.optionalKey(ValuesSchema),
    seconds: Schema.optionalKey(Schema.Struct({ least: Schema.Int, most: Schema.Int })),
    prompt_characters: Schema.Int,
    references: Schema.optionalKey(Schema.Struct({ most: Schema.Int, bytes: Schema.Int })),
  }).annotate({ description: 'The values each parameter takes, the seconds it makes and the references it takes' }),
  retired: Schema.optionalKey(
    Schema.Struct({ on: Schema.String, replacement: Schema.String }).annotate({
      description: 'The day it retires, YYYY-MM-DD, and the model that replaces it',
    }),
  ),
});

const GenerationModelListSchema = Schema.Struct({
  object: Schema.Literal('list'),
  as_of: Schema.String.annotate({
    description: 'Today, YYYY-MM-DD',
  }),
  gateways: ValuesSchema.annotate({
    description: 'The gateways of MODEL_GATEWAYS a function names its model through, by name; none where none is set',
  }),
  data: Schema.Array(ListedEntrySchema).annotate({
    description: 'The models of the catalogue, sorted by model, those that produce kind where it is given',
  }),
});

type GenerationModelList = typeof GenerationModelListSchema.Type;

type ListedEntry = typeof ListedEntrySchema.Type;

const modelNoun: Noun = { one: 'model', other: 'models' };

const kindWords: Readonly<Record<GenerationKind, string>> = { image: 'an image', audio: 'audio', video: 'a video' };

const kinds: readonly GenerationKind[] = ['image', 'audio', 'video'];

function lastPartOf(model: string): string {
  return model.slice(model.lastIndexOf('/') + 1);
}

function nameOf(model: string, models: readonly string[]): string {
  const last = lastPartOf(model);
  const sharing = models.filter((other) => lastPartOf(other) === last);
  return sharing.length === 1 ? last : `${last} of ${model.slice(0, model.indexOf('/'))}`;
}

function namedWith(named: readonly ListedEntry[], kind: GenerationKind, models: readonly string[]): readonly string[] {
  const names = named.filter((entry) => entry.kind === kind).map(({ model }) => nameOf(model, models));
  return names.length === 0 ? [] : [`${kindWords[kind]} with ${alternatives(names)}`];
}

function gatewayWords(gateways: readonly string[]): string {
  return gateways.length === 0
    ? 'No model gateway is configured, so no generation function can run until whoever runs the server configures one.'
    : '';
}

function hasRetired({ retired }: ListedEntry, day: string): boolean {
  return retired !== undefined && retired.on <= day;
}

function modelsWords({ data, gateways, as_of: day }: GenerationModelList, kind: GenerationKind | undefined) {
  const named = data.filter((entry) => !hasRetired(entry, day));
  if (named.length === 0) {
    return kind === undefined
      ? 'The catalogue names no model.'
      : `The catalogue names no model that makes ${kindWords[kind]}.`;
  }
  const through = gateways.length === 0 ? '' : ` through ${listed(gateways)}`;
  const models = data.map(({ model }) => model);
  const made = listed(kinds.flatMap((each) => namedWith(named, each, models)));
  return `A generation function can name ${counted(named.length, modelNoun)}${through}: it makes ${made}.`;
}

function retiredWords({ data, as_of: day }: GenerationModelList): readonly string[] {
  const models = data.map(({ model }) => model);
  return data.flatMap(({ model, retired }) => {
    if (retired === undefined) {
      return [];
    }
    const replacing = nameOf(retired.replacement, models);
    return retired.on <= day
      ? [`${nameOf(model, models)} was retired on ${retired.on}; ${replacing} replaces it.`]
      : [`${nameOf(model, models)} retires on ${retired.on}; name ${replacing} before then.`];
  });
}

function modelsListed(list: GenerationModelList, kind: GenerationKind | undefined): string {
  return [gatewayWords(list.gateways), modelsWords(list, kind), ...retiredWords(list)]
    .filter((words) => words !== '')
    .join(' ');
}

function listOf(
  catalog: GenerationCatalog,
  gateways: readonly string[],
  kind: GenerationKind | undefined,
  now: number,
): GenerationModelList {
  return {
    object: 'list',
    as_of: dayOf(now),
    gateways,
    data: catalog.entries.filter((entry) => kind === undefined || entry.kind === kind),
  };
}

type Asked = typeof InputSchema.Type;

const about = {
  name: 'list_generation_models',
  title: 'List generation models',
  description,
  inputSchema: InputSchema,
  outputSchema: GenerationModelListSchema,
  reasons: [],
  plainLanguage: {
    task,
    attempt: ({ kind }: Asked) => (kind === undefined ? task : `${task} that makes ${kindWords[kind]}`),
    outcome: (list: GenerationModelList, { kind }: Asked) => modelsListed(list, kind),
  },
};

export function defineListGenerationModels(catalog: GenerationCatalog, gateways: readonly string[]) {
  const handle = ({ kind }: Asked) =>
    Effect.map(Clock.currentTimeMillis, (now) => listOf(catalog, gateways, kind, now));
  return {
    org: defineQuery('org', {
      ...about,
      route: { method: 'GET', path: '/generation-models' },
      sameInEveryScope: true,
      handle,
    }),
    playbook: defineQuery('playbook', {
      ...about,
      route: { method: 'GET', path: '/generation-models' },
      sameInEveryScope: true,
      handle,
    }),
  };
}
