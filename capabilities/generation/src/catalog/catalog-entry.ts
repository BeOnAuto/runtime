import { Schema } from 'effect';

export const GenerationKindSchema = Schema.Literals(['image', 'audio', 'video']);

export type GenerationKind = typeof GenerationKindSchema.Type;

export const modelIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63}){0,2}$/u;

const catalogBounds = {
  promptCharacters: 100_000,
  references: 16,
  referenceBytes: 64 * 1_048_576,
  seconds: 3600,
  choiceCharacters: 32,
} as const;

const ModelIdSchema = Schema.String.check(Schema.isPattern(modelIdPattern)).annotate({
  description:
    'The model as the gateway names it, such as openai/gpt-image-2: lowercase letters, digits, dots, underscores and hyphens, in up to three parts joined by /',
});

const ChoiceSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9:._-]*$/u),
  Schema.isMaxLength(catalogBounds.choiceCharacters),
);

const ChoicesSchema = Schema.Array(ChoiceSchema).check(Schema.isMinLength(1));

const MediaTypeSchema = Schema.String.check(Schema.isPattern(/^(?:image|audio|video)\/[a-z0-9][a-z0-9.+-]*$/u));

const PromptCharactersSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: catalogBounds.promptCharacters }),
);

const SecondsSchema = Schema.Struct({
  least: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: catalogBounds.seconds })),
  most: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: catalogBounds.seconds })),
});

export type Seconds = typeof SecondsSchema.Type;

const ReferenceLimitsSchema = Schema.Struct({
  most: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: catalogBounds.references })),
  bytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: catalogBounds.referenceBytes })),
});

export type ReferenceLimits = typeof ReferenceLimitsSchema.Type;

const ImageLimitsSchema = Schema.Struct({
  sizes: Schema.optionalKey(ChoicesSchema),
  aspects: Schema.optionalKey(ChoicesSchema),
  qualities: Schema.optionalKey(ChoicesSchema),
  prompt_characters: PromptCharactersSchema,
  references: Schema.optionalKey(ReferenceLimitsSchema),
});

const AudioLimitsSchema = Schema.Struct({
  voices: ChoicesSchema,
  formats: ChoicesSchema,
  seconds: Schema.optionalKey(SecondsSchema),
  prompt_characters: PromptCharactersSchema,
});

const VideoLimitsSchema = Schema.Struct({
  sizes: Schema.optionalKey(ChoicesSchema),
  seconds: SecondsSchema,
  prompt_characters: PromptCharactersSchema,
  references: Schema.optionalKey(ReferenceLimitsSchema),
});

const RetiredSchema = Schema.Struct({
  on: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)).annotate({
    description: 'The day the provider retired the model, as YYYY-MM-DD',
  }),
  replacement: ModelIdSchema.annotate({ description: 'The model of the catalogue a definition names instead' }),
});

function entryOfKind<Kind extends GenerationKind, Limits extends Schema.Top>(kind: Kind, limits: Limits) {
  return Schema.Struct({
    model: ModelIdSchema,
    kind: Schema.Literal(kind),
    media_types: Schema.Array(MediaTypeSchema).annotate({
      description: 'The media types of the assets the model takes as references, none where it takes none',
    }),
    limits,
    retired: Schema.optionalKey(RetiredSchema),
  });
}

export const entrySchemas = {
  image: entryOfKind('image', ImageLimitsSchema),
  audio: entryOfKind('audio', AudioLimitsSchema),
  video: entryOfKind('video', VideoLimitsSchema),
} as const;

type ImageEntry = typeof entrySchemas.image.Type;

export type AudioEntry = typeof entrySchemas.audio.Type;

export type VideoEntry = typeof entrySchemas.video.Type;

export type CatalogEntry = ImageEntry | AudioEntry | VideoEntry;

export const KindOfAnEntrySchema = Schema.Struct({ kind: GenerationKindSchema });

export function referenceLimitsOf(entry: CatalogEntry): ReferenceLimits | undefined {
  return entry.kind === 'audio' ? undefined : entry.limits.references;
}

export function fileNameOf(model: string): string {
  return `${model.replaceAll('/', '-')}.yaml`;
}
