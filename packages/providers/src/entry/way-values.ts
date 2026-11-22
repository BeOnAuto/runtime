import { Schema } from 'effect';

import { PlaceholdersSchema } from './placeholders.ts';

const mostClientIdTitleCharacters = 40;

export const ownValueFields = {
  placeholders: Schema.optionalKey(
    PlaceholdersSchema.annotate({
      description:
        "The values a connection made this way takes beside the provider's, by name, asked only when this way is chosen: each written as a placeholder of the provider is, and held in this way's addresses or its base_url",
    }),
  ),
  base_url: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "For openapi, the https URL the calls of a connection made this way go to, in place of the provider's base_url and of the server its document names, each {name} in it a placeholder",
    }),
  ),
};

export const clientIdTitleField = Schema.optionalKey(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostClientIdTitleCharacters)).annotate({
    description:
      "For client_credentials and authorization, the label of the field a person gives the client's id in, as the service names it, in at most 40 characters",
  }),
);
