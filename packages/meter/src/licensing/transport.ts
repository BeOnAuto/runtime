import { boundedAnswerOf } from '@on.auto/outbound';

import type { LicenseFetch, LicenseTransport } from './records.ts';

export class LicenseServiceRefused extends Error {
  readonly status: number;

  constructor(status: number) {
    super('license_service_refused');
    this.status = status;
  }
}

function endpointFor(issuer: string): string {
  const url = new URL(issuer);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '')
    throw new Error('license_endpoint_invalid');
  return issuer.replace(/\/$/u, '');
}

function requestBody(value: unknown): string {
  const body = JSON.stringify(value);
  if (body === undefined || new TextEncoder().encode(body).byteLength > 8192)
    throw new Error('license_request_invalid');
  return body;
}

async function posted(
  request: Readonly<Request>,
  fetch: LicenseFetch,
  controller: Readonly<AbortController>,
): Promise<unknown> {
  const response = await fetch(request);
  if (response.status !== 200 && response.status !== 201) throw new LicenseServiceRefused(response.status);
  const bounded = boundedAnswerOf(response, 5 * 1024 * 1024, () => {
    controller.abort();
  });
  const result: unknown = await bounded.json();
  return result;
}

function publicFailure(error: unknown): Error {
  return error instanceof LicenseServiceRefused ? error : new Error('license_service_unavailable');
}

export function licenseTransport(issuer: string, fetch: LicenseFetch, timeout = 15_000): LicenseTransport {
  const endpoint = endpointFor(issuer);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new Error('license_timeout_invalid');
  return async (path, value) => {
    const body = requestBody(value);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeout);
    try {
      return await posted(
        new Request(`${endpoint}${path}`, {
          method: 'POST',
          redirect: 'manual',
          cache: 'no-store',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body,
        }),
        fetch,
        controller,
      );
    } catch (error) {
      throw publicFailure(error);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
