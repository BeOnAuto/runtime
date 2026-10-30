import {
  APICallError,
  EmptyResponseBodyError,
  InvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
  JSONParseError,
  LoadAPIKeyError,
  LoadSettingError,
  NoObjectGeneratedError,
  NoSuchModelError,
  RetryError,
  UnsupportedFunctionalityError,
} from 'ai';

import { CredentialsRejected } from '../failure/credentials-rejected.ts';
import { DefinitionInvalid } from '../failure/definition-invalid.ts';
import type { ModelFailure } from '../failure/model-failure.ts';
import { ProviderNotConfigured } from '../failure/provider-not-configured.ts';
import { ProviderUnavailable } from '../failure/provider-unavailable.ts';
import { UnclassifiedModelError } from '../failure/unclassified-model-error.ts';
import { credentialLookupMarker, OutboundFailure } from '../providers/outbound-failure.ts';
import { apiCallFailure } from './api-call-failure.ts';
import { outputFailure } from './output-failure.ts';

export interface FailureContext {
  readonly provider: string;
  readonly configured: readonly string[];
  readonly now: number;
  readonly showsProviderMessages: boolean;
  readonly scrub: (text: string) => string;
  readonly lastInputTokens: number | null;
}

export interface ProviderText {
  readonly status: number | null;
  readonly message: string;
}

const mostReportedCharacters = 2000;

type Recognizer = (error: unknown, context: FailureContext) => ModelFailure | null;

const mostRetryLayers = 4;

function credentialsUnavailable(provider: string): ModelFailure {
  return new CredentialsRejected({
    detail: `No credentials could be obtained for ${provider} from its credential source`,
    provider,
    status: null,
  });
}

const outbound: Recognizer = (error, { provider, configured }) => {
  if (!(error instanceof OutboundFailure)) {
    return null;
  }
  return error.reason === 'credential_lookup_failed'
    ? credentialsUnavailable(provider)
    : new ProviderNotConfigured({
        detail: `The TLS certificate of ${provider} is not trusted by this server; its operator must add the certificate authority`,
        provider,
        configured,
        missing: ['NODE_EXTRA_CA_CERTS'],
      });
};

const wrappedCredentials: Recognizer = (error, { provider }) =>
  error instanceof Error && error.message.includes(credentialLookupMarker) ? credentialsUnavailable(provider) : null;

const apiCall: Recognizer = (error, { provider, now, showsProviderMessages, scrub, lastInputTokens }) =>
  APICallError.isInstance(error)
    ? apiCallFailure({
        provider,
        status: error.statusCode,
        message: error.message,
        responseBody: error.responseBody,
        headers: error.responseHeaders,
        data: error.data,
        now,
        showsMessage: showsProviderMessages,
        scrub,
        lastInputTokens,
      })
    : null;

const unusableOutput: Recognizer = (error, { provider }) =>
  NoObjectGeneratedError.isInstance(error)
    ? outputFailure({
        provider,
        finishReason: error.finishReason ?? 'other',
        rawFinishReason: undefined,
        usage: error.usage,
        cause: error.cause,
      })
    : null;

function invalidDefinitionDetail(error: unknown): string | null {
  if (InvalidArgumentError.isInstance(error)) {
    return error.message;
  }
  if (UnsupportedFunctionalityError.isInstance(error)) {
    return `The model does not support ${error.functionality}`;
  }
  if (NoSuchModelError.isInstance(error)) {
    return 'The provider has no such model';
  }
  return InvalidPromptError.isInstance(error) ? 'The prompt is not valid for this model' : null;
}

const invalidDefinition: Recognizer = (error, { provider }) => {
  const detail = invalidDefinitionDetail(error);
  return detail === null
    ? null
    : new DefinitionInvalid({ detail, provider, status: null, provider_message: null, issues: [] });
};

function isUnreadableResponse(error: unknown): boolean {
  return (
    InvalidResponseDataError.isInstance(error) ||
    EmptyResponseBodyError.isInstance(error) ||
    JSONParseError.isInstance(error)
  );
}

const unreadableResponse: Recognizer = (error, { provider }) =>
  isUnreadableResponse(error)
    ? new ProviderUnavailable({ detail: `The response of ${provider} could not be read`, provider, status: null })
    : null;

function isMissingSetting(error: unknown): error is LoadAPIKeyError | LoadSettingError {
  return LoadAPIKeyError.isInstance(error) || LoadSettingError.isInstance(error);
}

const missingSetting: Recognizer = (error, { provider, configured }) =>
  isMissingSetting(error)
    ? new ProviderNotConfigured({
        detail: `${provider} is missing a setting on this server; its operator must add it`,
        provider,
        configured,
        missing: [],
      })
    : null;

const recognizers: readonly Recognizer[] = [
  outbound,
  wrappedCredentials,
  apiCall,
  unusableOutput,
  invalidDefinition,
  unreadableResponse,
  missingSetting,
];

function lastAttempt(error: unknown): unknown {
  let current = error;
  for (let layer = 0; layer < mostRetryLayers && RetryError.isInstance(current); layer += 1) {
    current = current.lastError;
  }
  return current;
}

function kindOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function classified(error: unknown, context: FailureContext): ModelFailure | UnclassifiedModelError {
  const attempt = lastAttempt(error);
  for (const recognize of recognizers) {
    const failure = recognize(attempt, context);
    if (failure !== null) {
      return failure;
    }
  }
  return new UnclassifiedModelError(context.provider, kindOf(attempt));
}

export function operatorHintOf(error: unknown, provider: string, scrub: (text: string) => string): string | null {
  const attempt = lastAttempt(error);
  if (attempt instanceof OutboundFailure && attempt.reason === 'untrusted_certificate') {
    return `The TLS certificate of ${provider} is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS`;
  }
  return isMissingSetting(attempt)
    ? `${provider} is missing a setting: ${scrub(attempt.message.trim()).slice(0, mostReportedCharacters)}`
    : null;
}

export function providerTextOf(error: unknown, scrub: (text: string) => string): ProviderText | null {
  const attempt = lastAttempt(error);
  if (!APICallError.isInstance(attempt) || attempt.message.trim() === '') {
    return null;
  }
  return {
    status: attempt.statusCode ?? null,
    message: scrub(attempt.message.trim()).slice(0, mostReportedCharacters),
  };
}
