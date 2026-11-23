import { RecordedCallerSchema } from '@on.auto/operations';
import { RecordedEventsSchema, scopesIn } from '@on.auto/providers';
import { Schema, SchemaTransformation } from 'effect';

import { AccountTypeField, PermissionsField, type RecordedCredential } from './acting-fields.ts';
import { ConnectionDocumentSchema, ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
import { CredentialSchema } from './credential.ts';

const ConnectionStatusSchema = Schema.Literals(['pending', 'connected', 'broken', 'removed']);

export const BrokenKindSchema = Schema.Literals([
  'credential_refused',
  'credential_wanted',
  'credential_gone',
  'credential_not_tokens',
  'consent_ended',
  'client_gone',
  'key_unknown',
]);

export type BrokenKind = typeof BrokenKindSchema.Type;

const BrokenSchema = Schema.Struct({
  kind: BrokenKindSchema.annotate({
    description:
      "Why, as a kind a client words for a person: credential_refused when its server refused the credential it holds, answering 401 or a code its provider names for a refused credential, credential_wanted when its server answered so to a connection that holds no credential, asking for one, credential_gone when its credential is no longer in the secret store, credential_not_tokens when it is not the tokens of a consent, consent_ended when its consent was revoked or has ended, client_gone when its client is no longer registered, key_unknown when Auto's consent service does not know its key",
  }),
  detail: Schema.String.annotate({ description: "Why, in the runtime's words, which say what mends it" }),
  at: Schema.String.annotate({ description: 'When it broke, in ISO 8601 UTC' }),
});

const SaidScopeSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The scope, as the authorization server names it' }),
  says: Schema.NullOr(Schema.String).annotate({
    description:
      "What a connection can do through it, in one sentence of its provider's entry, or null where the entry says nothing of it, as for a server given by hand",
  }),
});

export type SaidScope = typeof SaidScopeSchema.Type;

export const AccountSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id the service gives the account' }),
  name: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The name of the account when the connection was connected, for a person to read',
    }),
  ),
});

export type Account = typeof AccountSchema.Type;

export const InstalledSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The ID the service gives the installation' }),
  name: Schema.String.annotate({
    description:
      'The name of the account the application is installed on, as the service named it, for a person to read',
  }),
});

export type Installed = typeof InstalledSchema.Type;

export const ListedInstallationSchema = Schema.Struct({
  ...InstalledSchema.fields,
  admin: Schema.Boolean.annotate({
    description:
      'true where the person who signed in administers the account the installation is on: it is their own account, or an organization they are an admin of, as the service confirmed when it listed it. Only such an installation can be connected',
  }),
});

export type ListedInstallation = typeof ListedInstallationSchema.Type;

const SigningSecretSchema = Schema.Struct({
  set_at: Schema.String.annotate({ description: 'When it was set, in ISO 8601 UTC' }),
  previous_until: Schema.NullOr(Schema.String).annotate({
    description: 'Until when the signing secret it replaced also verifies, in ISO 8601 UTC, or null',
  }),
});

const AppCredentialHeldSchema = Schema.Struct({
  name: Schema.String.annotate({ description: "Its name, as its provider's entry names it" }),
  refused: Schema.NullOr(
    Schema.Struct({
      detail: Schema.String.annotate({ description: "Why, in the runtime's words, which say what mends it" }),
      at: Schema.String.annotate({ description: 'When the service refused it, in ISO 8601 UTC' }),
    }),
  ).annotate({
    description: 'Why and since when the service refused it, until the credential is given again; else null',
  }),
}).annotate({ description: 'An app credential the person gave beside the key, never the value' });

export type AppCredentialHeld = typeof AppCredentialHeldSchema.Type;

const OpenRequestSchema = Schema.Struct({
  message: Schema.NullOr(Schema.String).annotate({
    description: 'What the person who asked needs the app for, in their own words. It is null when they gave none.',
  }),
  requested_by: Schema.String.annotate({ description: 'The id of the caller who asked for it.' }),
  requested_at: Schema.String.annotate({ description: 'When it was asked for, in ISO 8601 UTC.' }),
});

export type OpenRequest = typeof OpenRequestSchema.Type;

const EventsAsGivenSchema = Schema.Record(Schema.String, Schema.Json)
  .annotate({
    description:
      'What add_connection was given as events for this connection, unchanged. It says how the service sends webhooks when someone replies. The field is absent when add_connection was given none.',
  })
  .pipe(Schema.decodeTo(RecordedEventsSchema, SchemaTransformation.passthroughSupertype()));

export const ConnectionSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the connection, a UUIDv7' }),
  name: Schema.String.annotate({ description: 'The name a function gives the connection in server/tool' }),
  type: ConnectionTypeSchema,
  provider: Schema.NullOr(Schema.String).annotate({
    description: 'The provider it was added from, by name, or null for a server given by hand',
  }),
  placeholders: Schema.NullOr(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "The values given for the provider's placeholders, or null",
  }),
  entry: ConnectionEntrySchema,
  document: Schema.optionalKey(ConnectionDocumentSchema),
  events: Schema.optionalKey(EventsAsGivenSchema),
  credential: CredentialSchema,
  permissions: PermissionsField,
  account_type: AccountTypeField,
  status: ConnectionStatusSchema.annotate({
    description: 'pending until it is approved and its credential given, connected, broken or removed',
  }),
  added_by: RecordedCallerSchema.annotate({ description: 'The caller who added it, by id and name' }),
  added_at: Schema.String.annotate({ description: 'When it was added, in ISO 8601 UTC' }),
  request: Schema.NullOr(OpenRequestSchema).annotate({
    description:
      'Someone who may not approve connections here asked the admins to connect it. The request stays open until an admin connects the connection or declines the request, or the connection is removed. It is null when there is no open request.',
  }),
  connected_at: Schema.NullOr(Schema.String).annotate({ description: 'When it was connected, in ISO 8601 UTC' }),
  connected_by: Schema.NullOr(RecordedCallerSchema).annotate({
    description: 'The caller who connected it, approving it or giving its credential, by id and name',
  }),
  asked_scopes: Schema.Array(SaidScopeSchema).annotate({
    description:
      'The scopes its credential asks, in its order, then those a consent that asks more added, each with what a connection can do through it; empty where it asks none',
  }),
  granted_scope: Schema.NullOr(Schema.String).annotate({
    description:
      'For a connection connected by consent, the scopes its authorization server granted at its latest consent, separated by single spaces, which may be fewer than that consent asked; else null',
  }),
  granted_scopes: Schema.NullOr(Schema.Array(SaidScopeSchema)).annotate({
    description:
      "The scopes of granted_scope, each with what a connection can do through it where its provider's entry says, which may be more or fewer than those asked; null where granted_scope is",
  }),
  credential_ends_with: Schema.NullOr(Schema.String).annotate({
    description:
      'The last four characters of the secret or client secret the person gave, where it holds twelve or more, kept beside the sealed value',
  }),
  broken: Schema.NullOr(BrokenSchema).annotate({ description: 'Why and since when it is broken, while it is' }),
  signing_secret: Schema.NullOr(SigningSecretSchema).annotate({
    description:
      'Whether its service may sign what it sends to this runtime, and since when, never the secret; null where it has none, and so receives nothing',
  }),
  account: Schema.NullOr(AccountSchema).annotate({
    description: 'The account at the service the connection is for, as the service named it; null where it named none',
  }),
  app_credentials: Schema.Array(AppCredentialHeldSchema).annotate({
    description:
      'The app credentials the person gave beside the key when the connection was connected, each by its name and whether the service has refused it, never the value; empty where they gave none',
  }),
  installation: Schema.optionalKey(
    InstalledSchema.annotate({
      description:
        'The installation of the application that the connection uses, and the account it is installed on. It is absent where the connection uses no installation.',
    }),
  ),
}).annotate({ identifier: 'Connection', description: 'A tool server the org added, shared by its playbooks' });

export type Connection = typeof ConnectionSchema.Type;

export const ModelField = Schema.String.annotate({
  description: 'The id of the model Auto answers members with, as list_models writes it',
});

export const ChatCredentialField = Schema.optionalKey(
  Schema.String.annotate({
    description:
      'The name of the app credential that lets members write to Auto through this connection, as give_credential takes it in app_credentials. Left out where the connection needs no further credential for it.',
  }),
);

export const MaySetModelField = Schema.Boolean.annotate({
  description: 'true when this caller may choose the model. false when it may not.',
});

export const ChatField = Schema.optionalKey(
  Schema.Struct({
    credential: ChatCredentialField,
    held: Schema.Boolean.annotate({
      description:
        'true while the connection holds that credential, given when it was last connected, even if the service has refused it. false when it does not hold it.',
    }),
    model: Schema.NullOr(ModelField).annotate({
      description: 'The id of the model Auto answers members with, as list_models writes it. null until one is chosen.',
    }),
    default_model: Schema.optionalKey(
      Schema.String.annotate({
        description:
          'The id of the model Auto answers members with while none is chosen, as list_models writes it. Left out where Auto answers nobody until one is chosen.',
      }),
    ),
    may_set_model: MaySetModelField,
  }).annotate({
    description:
      'Whether members can write to Auto through this connection, and the model Auto answers them with. Left out where they cannot.',
  }),
);

export const ConnectionWithChatSchema = Schema.Struct({ ...ConnectionSchema.fields, chat: ChatField }).annotate({
  identifier: 'ConnectionWithChat',
  description: 'A connection, and whether members can write to Auto through it',
});

export interface RecordedConnection extends Omit<Connection, 'credential_ends_with' | 'credential' | 'permissions'> {
  readonly credential: RecordedCredential;
}

export function connectionShown(connection: RecordedConnection, endsWith: string | null): Connection {
  const { permissions = null, ...credential } = connection.credential;
  return { ...connection, credential, permissions, credential_ends_with: endsWith };
}

export function withItsInstallation(
  { installation: _before, ...connection }: RecordedConnection,
  installed: Installed | undefined,
): RecordedConnection {
  return installed === undefined ? connection : { ...connection, installation: installed };
}

export function runsUnderTheOrgsOAuthClient({ credential }: Pick<RecordedConnection, 'credential'>): boolean {
  return credential.client_source === 'own';
}

export function connectsThroughItsGateway({ credential }: Pick<RecordedConnection, 'credential'>): boolean {
  return credential.client_source === 'gateway';
}

export function scopesSaid(scope: string | undefined, says: Readonly<Record<string, string>>): readonly SaidScope[] {
  return scopesIn(scope).map((name) => ({ name, says: says[name] ?? null }));
}

export function scopesAddedTo(
  asked: readonly SaidScope[],
  scope: string | undefined,
  says: Readonly<Record<string, string>>,
): readonly SaidScope[] {
  const named = new Set(asked.map(({ name }) => name));
  return [...asked, ...scopesSaid(scope, says).filter(({ name }) => !named.has(name))];
}

export function wordsOf(scopes: readonly SaidScope[]): Readonly<Record<string, string>> {
  return Object.fromEntries(scopes.flatMap(({ name, says }) => (says === null ? [] : [[name, says]])));
}
