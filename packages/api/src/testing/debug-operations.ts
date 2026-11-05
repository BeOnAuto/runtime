import { defineCommand, defineQuery, makeCatalog } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { guideShelfOf } from '../guides/guide-shelf.ts';
import { notebookGuide, testDefinitionTypes, testRecipes } from './guides.ts';
import { notebookOperations, plainly } from './notebook.ts';

const making = {
  title: 'Make',
  description: 'Makes something. Use it to make one. It answers that it did.',
  outputSchema: Schema.Struct({ made: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ made: true }),
  plainLanguage: plainly('make'),
} as const;

const createPlaybook = defineCommand('org', {
  name: 'create_playbook',
  route: { method: 'POST', path: '/make-playbook' },
  inputSchema: Schema.Struct({
    name: Schema.String.check(Schema.isMaxLength(100)).annotate({ description: 'The display name' }),
    look: Schema.optionalKey(Schema.Literals(['plain', 'fancy']).annotate({ description: 'How it looks' })),
    note: Schema.optionalKey(Schema.NullOr(Schema.String).annotate({ description: 'A note on it, or null' })),
    size: Schema.optionalKey(
      Schema.Struct({ pages: Schema.Number.annotate({ description: 'How many pages' }) }).annotate({
        description: 'How big it is',
      }),
    ),
  }),
  ...making,
});

const createDefinition = defineCommand('playbook', {
  name: 'create_definition',
  route: { method: 'POST', path: '/make-definition' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  ...making,
});

const runDefinition = defineQuery('playbook', {
  name: 'run_definition',
  route: { method: 'GET', path: '/run-definition' },
  inputSchema: Schema.Struct({ input: Schema.optionalKey(Schema.String.annotate({ description: 'The input' })) }),
  reachesOutside: true,
  ...making,
});

export const debugOperations = [...notebookOperations, createPlaybook, createDefinition, runDefinition];

export const directoryShelf = guideShelfOf([notebookGuide], testRecipes, testDefinitionTypes);

export const debugCatalog = makeCatalog(debugOperations);
