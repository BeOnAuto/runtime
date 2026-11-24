import { IconMediaTypeSchema, IconSizesSchema, IconThemeSchema } from '@on.auto/providers';
import { Schema } from 'effect';

export const ListedIconSchema = Schema.Struct({
  src: Schema.String.annotate({ description: 'The image, as a data URI.' }),
  mimeType: IconMediaTypeSchema.annotate({ description: "The image's file type, such as image/png." }),
  sizes: Schema.optionalKey(
    IconSizesSchema.annotate({
      description: 'The sizes the image is made for, such as 48x48, or any for an image that scales.',
    }),
  ),
  theme: Schema.optionalKey(
    IconThemeSchema.annotate({
      description:
        'light for an image made for a light background, dark for one made for a dark background. Left out when the image suits both.',
    }),
  ),
}).annotate({ identifier: 'ProviderIcon' });
