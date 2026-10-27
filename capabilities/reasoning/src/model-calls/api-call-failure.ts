import { clip } from '@on.auto/definitions/template';
import { Predicate } from 'effect';

import { ContentRefused } from '../failure/content-refused.ts';
import { CredentialsRejected } from '../failure/credentials-rejected.ts';
import { DefinitionInvalid } from '../failure/definition-invalid.ts';
import type { ModelFailure } from '../failure/model-failure.ts';
import { ProviderUnavailable } from '../failure/provider-unavailable.ts';
import { RateLimited } from '../failure/rate-limited.ts';
import { RequestTooLong } from '../failure/request-too-long.ts';

export interface ApiCallDetails {
  readonly provider: string;
  readonly status: number | undefined;
  readonly message: string;
  readonly responseBody: string | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;
  readonly data: unknown;
  readonly now: number;
  readonly showsMessage: boolean;
  readonly scrub: (text: string) => string;
  readonly lastInputTokens: number | null;
}

const mostShownCharacters = 300;

const mostShownCodeCharacters = 64;

const statusReadings: ReadonlyMap<number, string> = new Map([
  [400, 'the request was rejected as invalid'],
  [404, 'the model was not found'],
  [422, 'the request was rejected as invalid'],
]);

const contentFilterCodes: ReadonlySet<unknown> = new Set(['content_filter', 'content_policy_violation']);

const lengthCodes: ReadonlySet<unknown> = new Set(['context_length_exceeded', 'request_too_large']);

const unavailableStatuses: ReadonlySet<number> = new Set([408, 409]);

function errorFieldOf(data: unknown, field: 'code' | 'type'): unknown {
  return Predicate.hasProperty(data, 'error') && Predicate.hasProperty(data.error, field)
    ? data.error[field]
    : undefined;
}

function lengthSignalOf(status: number, data: unknown): string | undefined {
  if (status === 413) {
    return 'HTTP 413';
  }
  const code = errorFieldOf(data, 'code');
  if (lengthCodes.has(code)) {
    return `the error code ${String(code)}`;
  }
  const type = errorFieldOf(data, 'type');
  return lengthCodes.has(type) ? `the error type ${String(type)}` : undefined;
}

function codeInWords(data: unknown, scrub: (text: string) => string): string {
  const code = errorFieldOf(data, 'code');
  return typeof code === 'string' && code.trim() !== ''
    ? `, with the error code ${clip(scrub(code), mostShownCodeCharacters)}`
    : '';
}

function retryAfterSeconds(value: string, now: number): number | null {
  const seconds = Number(value);
  if (value.trim() !== '' && Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function retryAfterMs(headers: Readonly<Record<string, string>> | undefined, now: number): number | null {
  const milliseconds = Number(headers?.['retry-after-ms']);
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    return Math.ceil(milliseconds);
  }
  const after = headers?.['retry-after'];
  return after === undefined ? null : retryAfterSeconds(after, now);
}

const documentStart = /^[[{<]/u;

function firstLineOf(text: string): string {
  const lineEnd = text.indexOf('\n');
  return (lineEnd === -1 ? text : text.slice(0, lineEnd)).trimEnd();
}

function quotesBody(message: string, responseBody: string | undefined): boolean {
  return responseBody !== undefined && responseBody.trim() !== '' && message.includes(responseBody.trim());
}

function providerMessage({ message, responseBody, showsMessage, scrub }: ApiCallDetails): string | null {
  const trimmed = message.trim();
  const unusable = !showsMessage || trimmed === '' || documentStart.test(trimmed) || quotesBody(trimmed, responseBody);
  return unusable ? null : scrub(firstLineOf(trimmed)).slice(0, mostShownCharacters);
}

function tooLong(details: ApiCallDetails, status: number, signal: string): ModelFailure {
  const { provider } = details;
  return new RequestTooLong({
    detail: `${provider} refused the request as longer than the model takes, by ${signal}`,
    provider,
    status,
    signal,
    provider_message: providerMessage(details),
    last_input_tokens: details.lastInputTokens,
  });
}

function rejectedRequest(details: ApiCallDetails, code: number): ModelFailure {
  const { provider, data, scrub } = details;
  const signal = lengthSignalOf(code, data);
  if (signal !== undefined) {
    return tooLong(details, code, signal);
  }
  if (contentFilterCodes.has(errorFieldOf(data, 'code'))) {
    return new ContentRefused({
      detail: `${provider} refused the request under its content policy`,
      provider,
      status: code,
      raw_finish_reason: null,
      usage: null,
    });
  }
  return new DefinitionInvalid({
    detail: `${provider} answered HTTP ${code}: ${statusReadings.get(code) ?? 'the request was not accepted'}${codeInWords(data, scrub)}`,
    provider,
    status: code,
    provider_message: providerMessage(details),
    issues: [],
  });
}

export function apiCallFailure(details: ApiCallDetails): ModelFailure {
  const { provider, status } = details;
  if (status === undefined) {
    return new ProviderUnavailable({ detail: `${provider} could not be reached`, provider, status: null });
  }
  if (status === 401 || status === 403) {
    return new CredentialsRejected({
      detail: `${provider} rejected the credentials (HTTP ${status})`,
      provider,
      status,
    });
  }
  if (status === 429) {
    return new RateLimited({
      detail: `${provider} is limiting the rate of requests`,
      provider,
      retry_after_ms: retryAfterMs(details.headers, details.now),
    });
  }
  if (status >= 500 || unavailableStatuses.has(status)) {
    return new ProviderUnavailable({
      detail: `${provider} could not serve the request (HTTP ${status})`,
      provider,
      status,
    });
  }
  return status < 400
    ? new ProviderUnavailable({ detail: `The response of ${provider} could not be read`, provider, status })
    : rejectedRequest(details, status);
}
