import { describe, expect, it } from 'vitest';

import { isUntrustedCertificate } from '../index.ts';

function failedWith(...codes: readonly (string | undefined)[]): unknown {
  return codes.reduceRight<unknown>(
    (cause, code) => Object.assign(new Error('fetch failed'), code === undefined ? { cause } : { code, cause }),
    null,
  );
}

describe('a failure of an outbound call', () => {
  it('is of a certificate the server does not trust when any of its causes says so', () => {
    expect(isUntrustedCertificate(failedWith(undefined, 'SELF_SIGNED_CERT_IN_CHAIN'))).toBe(true);
    expect(isUntrustedCertificate(failedWith('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe(true);
    expect(isUntrustedCertificate(failedWith(undefined, 'ECONNREFUSED'))).toBe(false);
  });
});
