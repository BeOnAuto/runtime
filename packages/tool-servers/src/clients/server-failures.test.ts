import { INVALID_PARAMS, ProtocolError, SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { failureOf, untrustedCertificate } from './server-failures.ts';

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
