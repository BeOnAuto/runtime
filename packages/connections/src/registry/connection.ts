import { RecordedCallerSchema } from '@on.auto/operations';
import { scopesIn } from '@on.auto/providers';
import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
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
      "Why, as a kind a client words for a person: credential_refused when its server answered 401 to the credential it holds, credential_wanted when its server answered 401 to a connection that holds no credential, asking for one, credential_gone when its credential is no longer in the secret store, credential_not_tokens when it is not the tokens of a consent, consent_ended when its consent was revoked or has ended, client_gone when its client is no longer registered, key_unknown when Auto's consent service does not know its key",
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
  credential: CredentialSchema,
  status: ConnectionStatusSchema.annotate({
    description: 'pending until it is approved and its credential given, connected, broken or removed',
  }),
  added_by: RecordedCallerSchema.annotate({ description: 'The caller who added it, by id and name' }),
  added_at: Schema.String.annotate({ description: 'When it was added, in ISO 8601 UTC' }),
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
}).annotate({ identifier: 'Connection', description: 'A tool server the org added, shared by its playbooks' });

export type Connection = typeof ConnectionSchema.Type;

export type RecordedConnection = Omit<Connection, 'credential_ends_with'>;

export function connectionShown(connection: RecordedConnection, endsWith: string | null): Connection {
  return { ...connection, credential_ends_with: endsWith };
}

export function runsUnderTheOrgsApp({ credential }: Pick<RecordedConnection, 'credential'>): boolean {
  return credential.client_source === 'own';
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
