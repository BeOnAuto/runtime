import { generateKeyPairSync } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { rsaKeys } from '../testing/token-sources.ts';
import { keyFileOf, mostKeyFileBytes } from './key-files.ts';

const pointers = { client_id: '/client_email', private_key: '/private_key' };

const clientId = 'robot@acme.example.com';

let privateKey = '';

beforeAll(() => {
  privateKey = rsaKeys().privateKey;
});

function fileOf(fields: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ type: 'service_account', client_email: clientId, private_key: privateKey, ...fields });
}

function shortKey(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
}

function ellipticKey(): string {
  return generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
}

describe('a key file', () => {
  it('gives the value at each pointer, the private key a PKCS#8 key that signs for RS256', async () => {
    expect(await keyFileOf(fileOf({}), pointers)).toEqual({ clientId, privateKey });
  });

  it.each([
    ['text that is not JSON', () => 'client_email=robot@acme.example.com'],
    ['JSON that is not an object', () => JSON.stringify([clientId, privateKey])],
    ['a pointer that finds nothing', () => fileOf({ client_email: undefined })],
    ['a value that is not a string', () => fileOf({ client_email: { address: clientId } })],
    ['an empty value', () => fileOf({ client_email: '' })],
    ['a private key that is not a PEM', () => fileOf({ private_key: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC' })],
    ['a private key that cannot sign for RS256', () => fileOf({ private_key: ellipticKey() })],
    [
      'a private key of fewer than 2,048 bits, which RS256 does not sign with',
      () => fileOf({ private_key: shortKey() }),
    ],
  ])('is refused when it is %s', async (_case, text) => {
    expect(await keyFileOf(text(), pointers)).toBeUndefined();
  });

  it('is taken at the most bytes it may take, given here as its own size, and refused one byte past them', async () => {
    const file = fileOf({});
    const bytes = new TextEncoder().encode(file).byteLength;

    expect(await keyFileOf(file, pointers, bytes)).toEqual({ clientId, privateKey });
    expect(await keyFileOf(file, pointers, bytes - 1)).toBeUndefined();
  });

  it('takes 16 KiB as it ships, and refuses one byte more', async () => {
    const file = fileOf({});
    const fitting = file.padEnd(mostKeyFileBytes, ' ');

    expect([mostKeyFileBytes, fitting.length]).toEqual([16_384, 16_384]);
    expect(await keyFileOf(fitting, pointers)).toEqual({ clientId, privateKey });
    expect(await keyFileOf(`${fitting} `, pointers)).toBeUndefined();
  });
});
