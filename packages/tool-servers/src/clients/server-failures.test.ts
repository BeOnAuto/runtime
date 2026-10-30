import {
  INVALID_PARAMS,
  InsufficientScopeError,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
} from '@modelcontextprotocol/client';
import { HostRefused, HostUnresolved } from '@on.auto/outbound';
import { describe, expect, it } from 'vitest';

import { AnsweredStatus } from '../openapi/answered-status.ts';
import { ScopeLacking } from '../openapi/scope-lacking.ts';
import { ConnectionBroken, failureOf, isCredentialRefused, untrustedCertificate } from './server-failures.ts';

const answered = (status: number) =>
  new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, `Error POSTing to endpoint: ${status}`, { status });

function caused(...codes: readonly unknown[]): Error {
  const [code, ...deeper] = codes;
  const cause = deeper.length === 0 ? new Error('the socket') : caused(...deeper);
  return Object.assign(new Error('fetch failed', { cause }), { code });
}

describe('what a server failure is', () => {
  it('reads an HTTP answer by its status', () => {
    expect(failureOf(answered(401))).toEqual({ kind: 'key_refused', message: 'The tool server answered HTTP 401' });
    expect(failureOf(answered(403))).toEqual({ kind: 'failing', message: 'The tool server answered HTTP 403' });
    expect(failureOf(answered(404))).toEqual({ kind: 'forgotten', message: 'The tool server answered HTTP 404' });
    expect(failureOf(answered(429))).toEqual({ kind: 'rate_limited', message: 'The tool server answered HTTP 429' });
    expect(failureOf(answered(503))).toEqual({ kind: 'failing', message: 'The tool server answered HTTP 503' });
  });

  it('reads an error of the client by its code', () => {
    expect(failureOf(new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out'))).toEqual({
      kind: 'timed_out',
      message: 'The tool server did not answer in time',
    });
    expect(failureOf(new SdkError(SdkErrorCode.ConnectionClosed, 'Connection closed'))).toEqual({
      kind: 'closed',
      message: 'The connection to the tool server closed',
    });
    expect(failureOf(new SdkError(SdkErrorCode.ClientHttpUnexpectedContent, 'Unexpected content type'))).toEqual({
      kind: 'failing',
      message: 'Unexpected content type',
    });
  });

  it('reads an error the server answered, with arguments it refused as the tool refusing them', () => {
    expect(failureOf(new ProtocolError(INVALID_PARAMS, 'Tool lookup not found'))).toEqual({
      kind: 'refused',
      message: 'Tool lookup not found',
    });
    expect(failureOf(new ProtocolError(-32_603, 'Internal error'))).toEqual({
      kind: 'failing',
      message: 'The MCP server answered with an error: Internal error',
    });
  });

  it('reads a network failure by the codes of its causes', () => {
    expect(failureOf(caused(undefined, 'ECONNREFUSED'))).toEqual({
      kind: 'unreachable',
      message: 'The tool server could not be reached',
    });
    expect(failureOf(caused(undefined, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'))).toEqual({
      kind: 'failing',
      message: untrustedCertificate,
    });
    expect(failureOf(caused('EPROTO'))).toEqual({ kind: 'failing', message: 'fetch failed' });
    expect(failureOf('a string thrown')).toEqual({ kind: 'failing', message: 'a string thrown' });
  });
});

describe('what a host that cannot be looked up is', () => {
  it('is a server that could not be reached, to try again, however deep its cause lies', () => {
    const unresolved = new HostUnresolved({ host: 'crm.example.com' });

    expect(failureOf(unresolved)).toEqual({ kind: 'unreachable', message: 'The tool server could not be reached' });
    expect(failureOf(new Error('fetch failed', { cause: unresolved }))).toEqual({
      kind: 'unreachable',
      message: 'The tool server could not be reached',
    });
  });

  it('is not allowed where the host was refused, whatever else caused it', () => {
    const refusal = new HostRefused({ rule: 'no' });

    expect(failureOf(new Error('fetch failed', { cause: refusal }))).toEqual({ kind: 'not_allowed', message: 'no' });
  });
});

describe('what a refusal of the credential is', () => {
  it('is a 401 alone, whether the MCP client or an HTTP API answered it', () => {
    expect(
      [answered(401), new AnsweredStatus(401), answered(403), answered(429), answered(500)].map((error: unknown) =>
        isCredentialRefused(error),
      ),
    ).toEqual([true, true, false, false, false]);
  });

  it('is said, once a connection is broken by it, in the words its source recorded', () => {
    expect(failureOf(new ConnectionBroken('The credential of the connection crm was refused'))).toEqual({
      kind: 'broken',
      message: 'The credential of the connection crm was refused',
    });
  });
});

describe('what a scope the credential lacks is', () => {
  it('is a failure of its own kind that names the scope where the challenge names one, and that a credential granted it would be let through', () => {
    const scopeInTheBody = new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Error POSTing to endpoint', {
      status: 403,
      text: '{"error":"insufficient_scope"}',
    });
    const named =
      'The tool server answered HTTP 403: the credential lacks the scope files.write this request needs; a credential granted that scope would allow it';
    const unnamed =
      'The tool server answered HTTP 403: the credential lacks a scope this request needs; a credential granted that scope would allow it';

    expect(
      [
        new InsufficientScopeError({ requiredScope: 'files.write' }),
        new InsufficientScopeError({}),
        scopeInTheBody,
        new ScopeLacking(named),
      ].map((error: unknown) => failureOf(error)),
    ).toEqual([
      { kind: 'scope_lacking', message: named },
      { kind: 'scope_lacking', message: unnamed },
      { kind: 'scope_lacking', message: unnamed },
      { kind: 'scope_lacking', message: named },
    ]);
  });

  it('is not a 403 that names another error', () => {
    const refusedForAnotherReason = new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Error', {
      status: 403,
      text: '{"error":"forbidden"}',
    });

    expect(failureOf(refusedForAnotherReason)).toEqual({
      kind: 'failing',
      message: 'The tool server answered HTTP 403',
    });
  });
});
