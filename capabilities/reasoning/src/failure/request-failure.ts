import type { CredentialsRejected } from './credentials-rejected.ts';
import type { DefinitionInvalid } from './definition-invalid.ts';
import type { ModelNotAllowed } from './model-not-allowed.ts';
import type { ProviderNotConfigured } from './provider-not-configured.ts';
import type { RequestTooLong } from './request-too-long.ts';

export type AdmissionFailure = DefinitionInvalid | ProviderNotConfigured | ModelNotAllowed;

export type RequestFailure =
  | DefinitionInvalid
  | RequestTooLong
  | ProviderNotConfigured
  | ModelNotAllowed
  | CredentialsRejected;
