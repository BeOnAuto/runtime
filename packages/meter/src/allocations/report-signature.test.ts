import { describe, expect, it } from 'vitest';

import { reportSignatureOf } from './report-signature.ts';

const key = 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f.q8Zx1v0pR4kN7sT2wY5bC9eH3jL6mP0aD4fG8iK1nQs';

const report = {
  allocation: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  installation: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f',
  sequence: 3,
  spent: 41,
  at: '2026-10-27T12:00:00.000Z',
};

async function signedAsAutoChecksIt(): Promise<string> {
  const secret = key.split('.')[3] ?? '';
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))).toString('hex');
  const hmac = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(digest),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const text = [report.allocation, report.installation, report.sequence, report.spent, report.at].join('.');
  return Buffer.from(await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(text))).toString('hex');
}

describe('the signature of a report of an allocation', () => {
  it('is HMAC-SHA256 keyed by the hex SHA-256 of the secret of its key, over its fields joined by a dot, in hex', async () => {
    expect(reportSignatureOf(key, report)).toBe(await signedAsAutoChecksIt());
    expect(reportSignatureOf(key, report)).toBe('246a71b7b3f2015a5b55602a3de9e23a8f50fe7f1afd3a99ac1f85e9f4c44692');
  });
});
