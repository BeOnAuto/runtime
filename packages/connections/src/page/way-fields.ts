import { AccountTypeSchema, PermissionsSchema } from '@on.auto/providers';
import { Schema } from 'effect';

import { ConnectionIdField, TokenField } from '../operations/connection-fields.ts';
import { CredentialKindSchema } from '../registry/credential.ts';
import { ServiceAccountChoiceSchema } from '../registry/exchange-credentials.ts';

export const ChoosingTheWaySchema = Schema.Struct({
  id: ConnectionIdField,
  token: TokenField,
  credential: Schema.Struct({
    kind: CredentialKindSchema.annotate({ description: 'The kind of the way, as the list of ways names it.' }),
    permissions: Schema.optionalKey(
      PermissionsSchema.annotate({
        description:
          'application or delegated, as the list of ways names it. client_credentials always means application. Left out, every other kind that sends a credential means delegated.',
      }),
    ),
    service_account: Schema.optionalKey(
      ServiceAccountChoiceSchema.annotate({
        description:
          'managed for the way that acts as a service account Auto creates, as the list of ways names it in service_account. Left out for any other way.',
      }),
    ),
  }).annotate({
    description:
      'The way to connect. For a connection made from a provider, one of the ways list_providers lists for it. For a server given by hand, one of the ways read_link lists in ways.',
  }),
  account_type: Schema.optionalKey(
    AccountTypeSchema.annotate({
      description:
        'service when the connection will act as an account the company made for automations. personal when it will act as the account of the person who connects it. Left out when another way is chosen, it is personal if the way takes personal accounts, and otherwise the type the way takes. Left out for the way the connection already has, the type stays as it is.',
    }),
  ),
  placeholders: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description:
        "The values the way asks for, by name, as list_providers lists them in the way's placeholders. Give every one of them. Left out for the way the connection already has, its values stay as they are.",
    }),
  ),
});
