import { WayClientSourceSchema, WayPkceSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { AccountTypesSchema } from './account-types.ts';
import { GatewaySchema, PermissionsSchema } from './gateway-ways.ts';
import { PlaceholdersSchema } from './placeholders.ts';
import { ScopeGroupSchema, ScopeWordsSchema } from './scope-groups.ts';
import { namesIn } from './templates.ts';

const mostClientIdTitleCharacters = 40;

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

export const mostLimitationCharacters = 160;

export function limitationSchemaOf(mostCharacters: number) {
  return Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostCharacters)).annotate({
    description: `What a connection made this way cannot do, in one sentence of at most ${String(mostCharacters)} characters, which a person reads under this way where they connect the app.`,
  });
}

export const wayFields = {
  in: Schema.Literals(['header', 'query', 'security']),
  name: NamedSchema,
  scheme: NamedSchema,
  issuer: Schema.String,
  scope: Schema.String,
  parameters: Schema.Record(Schema.String, Schema.String),
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  revocation_endpoint: Schema.String,
  pkce: WayPkceSchema,
  clients: Schema.Array(WayClientSourceSchema),
  oauth_client: Schema.Literal('required'),
  says: ScopeWordsSchema,
  more: Schema.Array(ScopeGroupSchema).check(Schema.isMinLength(1)),
  ending_codes: Schema.Array(NamedSchema).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  gateway: GatewaySchema,
  permissions: PermissionsSchema,
  account_types: AccountTypesSchema,
  refresh_token_expires_in: Schema.Int.check(Schema.isGreaterThan(0)),
};

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
  path_values: Schema.optionalKey(
    Schema.Record(NamedSchema, NamedSchema).annotate({
      description:
        "For openapi, the value sent for a path parameter of the document, by the parameter's name, in every call of a connection made this way. No tool of such a connection offers the parameter as an argument, so no call can change it; a connection made another way offers it",
    }),
  ),
};

export const clientIdTitleField = Schema.optionalKey(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostClientIdTitleCharacters)).annotate({
    description:
      "For client_credentials and authorization, the label of the field a person gives the client's id in, as the service names it, in at most 40 characters",
  }),
);

const pathValueWrittenOut =
  'Expected a value written out, with no placeholder: a path value is read from the entry when a connection is served';

interface GivingPathValues {
  readonly path_values?: Readonly<Record<string, string>> | undefined;
}

export function pathValueIssuesOf({ path_values: pathValues = {} }: GivingPathValues): readonly Schema.FilterIssue[] {
  return Object.entries(pathValues)
    .filter(([, value]: readonly [string, string]) => namesIn(value).length > 0)
    .map(([name]: readonly [string, string]) => ({ path: ['path_values', name], issue: pathValueWrittenOut }));
}
