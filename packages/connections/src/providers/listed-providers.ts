import { WayKindSchema, wayFields } from '@on.auto/providers';
import { Schema } from 'effect';

import { ConnectionTypeSchema } from '../registry/connection-entry.ts';

const ListedWaySchema = Schema.Struct({
  kind: WayKindSchema,
  in: Schema.optionalKey(wayFields.in),
  name: Schema.optionalKey(wayFields.name),
  scheme: Schema.optionalKey(wayFields.scheme),
  issuer: Schema.optionalKey(wayFields.issuer),
  scope: Schema.optionalKey(wayFields.scope),
  description: Schema.optionalKey(Schema.String),
  offered: Schema.Boolean.annotate({ description: 'Whether a person may connect the provider this way here' }),
  because: Schema.optionalKey(Schema.String.annotate({ description: 'Why the way is not offered, where it is not' })),
}).annotate({ description: 'A way a credential reaches the server, the first the default' });

export type ListedWay = typeof ListedWaySchema.Type;

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
