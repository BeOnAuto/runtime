import { defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { ModelCatalog } from './catalog-listing.ts';
import { modelsListed } from './catalog-words.ts';
import { ModelListSchema, type ModelList } from './model-list.ts';

const task = 'list the models this server can call';

const description = [
  'Lists the models this server can call, by the id a reasoning function gives as its model, written provider/model.',
  'An id ending in * stands for any model of its provider and is not one to run.',
  'Use it before a reasoning function names its model, or when a run says its model is not offered.',
].join(' ');

const InputSchema = Schema.Struct({
  provider: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Lists only the models this provider prefix serves, such as anthropic or the name of a gateway',
    }).check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u)),
  ),
});

function withSetup(list: ModelList, provider: string | undefined, providerSetup: string | undefined): ModelList {
  return list.data.length === 0 && provider === undefined && providerSetup !== undefined
    ? { ...list, provider_setup: providerSetup }
    : list;
}

export function defineListModels(catalog: ModelCatalog, providerSetup?: string) {
  return defineQuery('org', {
    name: 'list_models',
    title: 'List models',
    description,
    route: { method: 'GET', path: '/models' },
    reachesOutside: true,
    inputSchema: InputSchema,
    outputSchema: ModelListSchema,
    reasons: [],
    handle: ({ provider }) => Effect.map(catalog.list(provider), (list) => withSetup(list, provider, providerSetup)),
    plainLanguage: {
      task,
      attempt: ({ provider }) => (provider === undefined ? task : `${task} through ${provider}`),
      outcome: (list, { provider }) => modelsListed(list, provider, providerSetup),
    },
  });
}
