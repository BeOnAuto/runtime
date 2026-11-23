import { AccountTypeSchema, PermissionsSchema } from '@on.auto/providers';
import { Schema } from 'effect';

import { CredentialFieldsSchema, credentialFieldIssuesOf } from './credential.ts';

const { kind, ...fieldsOfItsKinds } = CredentialFieldsSchema.fields;

export const RecordedCredentialFieldsSchema = Schema.Struct({
  kind,
  permissions: Schema.optionalKey(PermissionsSchema),
  ...fieldsOfItsKinds,
});

export const RecordedCredentialSchema = RecordedCredentialFieldsSchema.check(
  Schema.makeFilter((credential: typeof CredentialFieldsSchema.Type) => credentialFieldIssuesOf(credential)),
);

export type RecordedCredential = typeof RecordedCredentialSchema.Type;

export const PermissionsField = Schema.NullOr(PermissionsSchema).annotate({
  description:
    'application when the connection acts as the app. delegated when it acts as an account at the service. null when it sends no credential.',
});

export const AccountTypeField = Schema.NullOr(AccountTypeSchema).annotate({
  description:
    'service when the connection acts as an account the company made for automations. personal when it acts as the account of the person who connected it. null when it acts as the app or sends no credential.',
});
