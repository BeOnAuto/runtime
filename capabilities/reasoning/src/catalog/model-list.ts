import { Schema } from 'effect';

const Count = Schema.Int.check(Schema.isGreaterThan(0));

const ModelEntrySchema = Schema.Struct({
  id: Schema.String.annotate({
    description:
      'The model as a reasoning function names it, provider/model id, such as anthropic/claude-sonnet-4-5; an alias as its operator wrote it',
  }),
  object: Schema.Literal('model'),
  created: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description:
      'When the provider released or added the model, in seconds since 1970; 0 when the provider does not say',
  }),
  owned_by: Schema.String.annotate({ description: 'The provider prefix that serves the model' }),
  name: Schema.optionalKey(Schema.String.annotate({ description: 'The name the provider gives the model' })),
  context_window: Schema.optionalKey(
    Count.annotate({ description: 'The most input tokens the model takes, when the provider reports it' }),
  ),
  max_tokens: Schema.optionalKey(
    Count.annotate({ description: 'The most output tokens the model writes, when the provider reports it' }),
  ),
  alias: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description: 'true for an alias its operator named, whether or not resolved_to shows where it is sent',
    }),
  ),
  resolved_to: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'For an alias, the model reference it is sent to; left out when that is a Bedrock ARN, which names an account and a region',
    }),
  ),
  pattern: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description: 'true when the id ends in *, which stands for any model id in its place',
    }),
  ),
});

export type ModelEntry = typeof ModelEntrySchema.Type;

const CatalogStatusSchema = Schema.Literals(['complete', 'partial']);

export const ModelListSchema = Schema.Struct({
  object: Schema.Literal('list'),
  data: Schema.Array(ModelEntrySchema),
  catalog_status: CatalogStatusSchema.annotate({
    description:
      'partial when a provider could not be asked just now, so its models are missing or as they were when last read',
  }),
  narrowed: Schema.Boolean.annotate({
    description:
      'true when the operator allows only some models, so the list holds only those; false when a reasoning function may name any model of the configured providers',
  }),
  listed_at: Schema.String.annotate({
    description: 'When the oldest list of models in the answer was read from its provider, in ISO 8601',
  }),
  provider_setup: Schema.optionalKey(
    Schema.String.annotate({
      description: 'When the server has no model it can call at all, how the person who runs it adds a model provider',
    }),
  ),
});

export type ModelList = typeof ModelListSchema.Type;
