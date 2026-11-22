import { AccountTypeSchema, WayKindSchema, wayFields } from '@on.auto/providers';
import { ClientSourceSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { ConnectionTypeSchema } from '../registry/connection-entry.ts';

const ListedScopesSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String.annotate({ description: 'A scope, as the authorization server names it' }),
    says: Schema.String.annotate({ description: 'What a connection can do through it, in one sentence' }),
  }),
);

const ListedStepSchema = Schema.Struct({
  title: Schema.String.annotate({ description: 'The heading of the step' }),
  instructions: Schema.String.annotate({ description: 'What the person does in the step, in Markdown' }),
});

const ListedPageStepSchema = Schema.Struct({
  ...ListedStepSchema.fields,
  page: Schema.String.annotate({ description: 'The https page of the service where the person does the step' }),
  page_title: Schema.String.annotate({ description: 'The label of the button that opens the page' }),
});

const ListedPlaceholderSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The label of the field the person gives the value in, where the entry gives one.',
    }),
  ),
  description: Schema.String,
  pattern: Schema.optionalKey(Schema.String),
  example: Schema.optionalKey(Schema.String),
  required: Schema.Boolean,
  choices: Schema.optionalKey(Schema.Array(Schema.Struct({ value: Schema.String, title: Schema.String }))),
}).annotate({ description: 'A value that differs per connection, which the person gives when they connect' });

export type ListedPlaceholder = typeof ListedPlaceholderSchema.Type;

const OAuthClientChoiceSchema = Schema.Literals(['optional', 'required']);

export type OAuthClientChoice = typeof OAuthClientChoiceSchema.Type;

export const ListedWaySchema = Schema.Struct({
  kind: WayKindSchema,
  in: Schema.optionalKey(wayFields.in),
  name: Schema.optionalKey(wayFields.name),
  scheme: Schema.optionalKey(wayFields.scheme),
  issuer: Schema.optionalKey(wayFields.issuer),
  permissions: Schema.optionalKey(
    wayFields.permissions.annotate({
      description:
        'application when a connection made this way acts as the app. delegated when it acts as an account at the service. Left out when the way sends no credential.',
    }),
  ),
  account_types: Schema.optionalKey(
    Schema.Array(AccountTypeSchema).annotate({
      description:
        'The kinds of account a connection made this way may act as. service is an account the company made for automations. personal is the account of the person who connects. Left out when the way acts as the app or sends no credential.',
    }),
  ),
  oauth_client: Schema.optionalKey(
    OAuthClientChoiceSchema.annotate({
      description:
        "For authorization, whether the person may connect under the organization's own OAuth client, a client the organization registers with the provider and gives the client ID and client secret of on the page: optional, beside the client Auto or whoever runs it has there, or required, where the way connects under the organization's own OAuth client alone, as it says or since no client here covers it",
    }),
  ),
  client_source: Schema.optionalKey(
    ClientSourceSchema.annotate({
      description:
        "For authorization whose oauth_client is optional, the source of the client a start takes without the organization's own, as read_link names it",
    }),
  ),
  scopes: ListedScopesSchema.annotate({
    description: 'The scopes its first consent asks, in its order, each with its words; empty where it asks none',
  }),
  more: Schema.Array(
    Schema.Struct({
      name: Schema.String.annotate({
        description: 'The name of the group, which add_connection and reconnect_connection take as more',
      }),
      for: Schema.String.annotate({ description: "What the group is for, in one sentence of the person's words" }),
      scopes: ListedScopesSchema.annotate({ description: 'The scopes it adds, in its order, each with its words' }),
    }),
  ).annotate({
    description:
      'The groups of scopes a later consent of a connection made this way may add to what it holds; empty where it names none',
  }),
  description: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "What a person reads of the way; for secret, the short name of the key, the label of the field it is given in, beside the instructions and the key page the connection's credential holds",
    }),
  ),
  key_page: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "The https page where a person makes the key, the client or the key file, or, for authorization, the organization's own OAuth client. Given for a way whose entry names one.",
    }),
  ),
  key_page_title: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'For secret, client_credentials, jwt_bearer and authorization, the label of the button that opens the key page, where the entry gives one; left out otherwise',
    }),
  ),
  client_id_title: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "For client_credentials and authorization, the label of the field the person gives the client's ID in, as the service names it, where the entry gives one.",
    }),
  ),
  steps: Schema.optionalKey(
    Schema.Struct({
      key_page: Schema.optionalKey(ListedStepSchema),
      pages: Schema.optionalKey(Schema.Array(ListedPageStepSchema)),
      key: Schema.optionalKey(ListedStepSchema),
      connected: Schema.optionalKey(ListedStepSchema),
    }).annotate({
      description:
        "For secret, client_credentials, jwt_bearer and authorization, the heading and paragraph of each step of the page where a person approves the connection, where the entry gives them: key_page, above the button that opens the key page; pages, the steps the person does on other pages of the service, in order, each with the button that opens its page; key, above the field of the key, or for authorization above the fields of the organization's own OAuth client; connected, what the person does once the connection is connected. For authorization, they are the steps of making the organization's own OAuth client, shown where the connection goes under it",
    }),
  ),
  refresh_token_expires_in: Schema.optionalKey(
    wayFields.refresh_token_expires_in.annotate({
      description:
        'For authorization, how long the provider keeps a refresh token, in seconds, after which the person signs in again, where the entry states it; left out otherwise. Auto enforces nothing from it.',
    }),
  ),
  app_credentials: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String.annotate({
          description: "Its name, as give_credential's app_credentials takes it beside the value of the key",
        }),
        description: Schema.String.annotate({ description: 'The label of the field it is given in' }),
        title: Schema.optionalKey(
          Schema.String.annotate({ description: 'The heading of its step, where the entry gives one' }),
        ),
        instructions: Schema.String.annotate({ description: 'How a person makes it, in Markdown' }),
        key_page: Schema.optionalKey(
          Schema.String.annotate({ description: 'The https address of the page where a person makes it' }),
        ),
        example: Schema.optionalKey(
          Schema.String.annotate({ description: 'What it looks like, with … in place of its characters' }),
        ),
        pattern: Schema.optionalKey(
          Schema.String.annotate({
            description: 'The regular expression from ^ to $ every such value matches, which give_credential checks',
          }),
        ),
      }),
    ).annotate({
      description:
        'For secret, the app credentials a person may give beside the key, such as an app-level token, each optional to them, where this runtime can use them; left out where it takes none',
    }),
  ),
  placeholders: Schema.optionalKey(
    Schema.Array(ListedPlaceholderSchema).annotate({
      description:
        "The values this way asks for beside the provider's placeholders, which add_connection and choose_way take in placeholders. Left out where the way asks for none.",
    }),
  ),
  offered: Schema.Boolean.annotate({ description: 'Whether a person may connect the provider this way here' }),
  because: Schema.optionalKey(
    Schema.String.annotate({
      description: "Why the way is not offered, or why only under the organization's own OAuth client",
    }),
  ),
}).annotate({ description: 'A way a credential reaches the server, the first the default' });

export type ListedWay = typeof ListedWaySchema.Type;

export const listedWayOf = Schema.decodeUnknownSync(ListedWaySchema);

const ProviderSchema = Schema.Struct({
  name: Schema.String.annotate({ description: "The provider's name, the default name of a connection to it" }),
  title: Schema.String.annotate({ description: 'What a person reads' }),
  description: Schema.String,
  summary: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'What playbooks can do through it, in one sentence a person reads under its title where they connect it, where the entry gives one; left out otherwise',
    }),
  ),
  website: Schema.String.annotate({ description: 'Where a person reads about the server and makes a credential' }),
  type: ConnectionTypeSchema,
  credentials: Schema.Array(ListedWaySchema),
  placeholders: Schema.Array(ListedPlaceholderSchema),
  replaces: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'The providers this one replaces, by name: where one is listed, none of its ways is offered, and reconnecting a connection made from it adds it again from this one under its name',
    }),
  ),
  may_reconnect: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'Beside replaces: whether this caller may reconnect a connection made from a provider it replaces, whoever added it, true for a caller the runtime lets do so here and false for a caller it starts no connection of this provider for; left out where the person who added such a connection reconnects it, or where the runtime cannot say just now',
    }),
  ),
  reconnect_refusal: Schema.optionalKey(
    Schema.String.annotate({ description: 'Why this caller may not, where may_reconnect is false' }),
  ),
}).annotate({ identifier: 'Provider', description: 'A service a person may connect, by its name' });

export type ListedProvider = typeof ProviderSchema.Type;

export const ProvidersSchema = Schema.Struct({
  providers: Schema.Array(ProviderSchema),
  may_add: Schema.Boolean.annotate({ description: 'Whether this caller may add a connection here' }),
  may_connect: Schema.Boolean.annotate({
    description: 'true when this caller may also approve a connection it adds here. false when it may not.',
  }),
  refusal: Schema.NullOr(Schema.String).annotate({ description: 'Why this caller may not add a connection here' }),
  return_address: Schema.String.annotate({
    description:
      "The address the runtime sends a provider's authorization server as redirect_uri for a connection under the organization's own OAuth client, which that client registers as an authorized redirect URI",
  }),
});
