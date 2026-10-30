import { WayKindSchema, wayFields } from '@on.auto/providers';
import { Schema } from 'effect';

import { ConnectionTypeSchema } from '../registry/connection-entry.ts';

const ListedScopesSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String.annotate({ description: 'A scope, as the authorization server names it' }),
    says: Schema.String.annotate({ description: 'What a connection can do through it, in one sentence' }),
  }),
);

const OwnAppSchema = Schema.Literals(['optional', 'required']);

export type OwnAppChoice = typeof OwnAppSchema.Type;

const ListedWaySchema = Schema.Struct({
  kind: WayKindSchema,
  in: Schema.optionalKey(wayFields.in),
  name: Schema.optionalKey(wayFields.name),
  scheme: Schema.optionalKey(wayFields.scheme),
  issuer: Schema.optionalKey(wayFields.issuer),
  own_app: Schema.optionalKey(
    OwnAppSchema.annotate({
      description:
        "For authorization, whether the person may connect under the org's own app, an app the org registers with the provider and gives the client id and client secret of on the page: optional, beside the client Auto or whoever runs it has there, or required, where the way connects under the org's own app alone, as it says or since no client here covers it",
    }),
  ),
  scopes: ListedScopesSchema.annotate({
    description: 'The scopes its first consent asks, in its order, each with its words; empty where it asks none',
  }),
  more: Schema.Array(
    Schema.Struct({
      name: Schema.String.annotate({ description: 'The name of the group, which reconnect_connection takes as more' }),
      for: Schema.String.annotate({ description: "What the group is for, in one sentence of the person's words" }),
      scopes: ListedScopesSchema.annotate({ description: 'The scopes it adds, in its order, each with its words' }),
    }),
  ).annotate({
    description:
      'The groups of scopes a later consent of a connection made this way may add to what it holds; empty where it names none',
  }),
  description: Schema.optionalKey(Schema.String),
  offered: Schema.Boolean.annotate({ description: 'Whether a person may connect the provider this way here' }),
  because: Schema.optionalKey(
    Schema.String.annotate({ description: "Why the way is not offered, or why only under the org's own app" }),
  ),
}).annotate({ description: 'A way a credential reaches the server, the first the default' });

export type ListedWay = typeof ListedWaySchema.Type;

export const listedWayOf = Schema.decodeUnknownSync(ListedWaySchema);

const ListedPlaceholderSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  pattern: Schema.optionalKey(Schema.String),
  example: Schema.optionalKey(Schema.String),
  required: Schema.Boolean,
  choices: Schema.optionalKey(Schema.Array(Schema.Struct({ value: Schema.String, title: Schema.String }))),
}).annotate({ description: 'A value that differs per connection, which the person gives when they connect' });

export type ListedPlaceholder = typeof ListedPlaceholderSchema.Type;

const ProviderSchema = Schema.Struct({
  name: Schema.String.annotate({ description: "The provider's name, the default name of a connection to it" }),
  title: Schema.String.annotate({ description: 'What a person reads' }),
  description: Schema.String,
  website: Schema.String.annotate({ description: 'Where a person reads about the server and makes a credential' }),
  type: ConnectionTypeSchema,
  credentials: Schema.Array(ListedWaySchema),
  placeholders: Schema.Array(ListedPlaceholderSchema),
}).annotate({ identifier: 'Provider', description: 'A service a person may connect, by its name' });

export type ListedProvider = typeof ProviderSchema.Type;

export const ProvidersSchema = Schema.Struct({
  providers: Schema.Array(ProviderSchema),
  may_add: Schema.Boolean.annotate({ description: 'Whether this caller may add a connection here' }),
  refusal: Schema.NullOr(Schema.String).annotate({ description: 'Why this caller may not add a connection here' }),
});
