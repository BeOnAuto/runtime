import { Buffer } from 'node:buffer';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { rsaKeys } from '../testing/token-sources.ts';
import { keyFileOf, keyFileReadOf, mostKeyFileBytes, pemKeyOf } from './key-files.ts';

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

const appId = '1234567';

const pem = { format: 'pem' } as const;

function inPkcs1(modulusLength = 2048): { readonly pkcs1: string; readonly pkcs8: string } {
  const { privateKey: pkcs1 } = generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return { pkcs1, pkcs8: createPrivateKey(pkcs1).export({ type: 'pkcs8', format: 'pem' }) };
}

function armoured(label: string, bytes: readonly number[], closing = label): string {
  return `-----BEGIN ${label}-----\n${Buffer.from(bytes).toString('base64')}\n-----END ${closing}-----\n`;
}

describe('a key file that is the private key itself in PEM', () => {
  it('gives the key in PKCS #8, as it is given or rewrapped from PKCS #1, and the client the way names', async () => {
    const { pkcs1, pkcs8 } = inPkcs1();

    expect(await keyFileReadOf(privateKey, pem, appId)).toEqual({ clientId: appId, privateKey });
    expect(await keyFileReadOf(`\n${pkcs1}\n`, pem, appId)).toEqual({ clientId: appId, privateKey: pkcs8 });
    expect(pkcs1.startsWith('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
  });

  it.each([
    ['given for a way that names no client', () => privateKey, undefined],
    ['a JSON key file', () => fileOf({}), appId],
    ['a public key', () => rsaKeys().publicKey, appId],
    ['a key of fewer than 2,048 bits, in PKCS #1', () => inPkcs1(1024).pkcs1, appId],
    ['a key that cannot sign for RS256', () => ellipticKey(), appId],
    [
      'armour whose closing line names another kind of key',
      () => armoured('RSA PRIVATE KEY', [0x30], 'PRIVATE KEY'),
      appId,
    ],
    ['armour around nothing', () => '-----BEGIN PRIVATE KEY-----\n====\n-----END PRIVATE KEY-----', appId],
    ['armour around bytes that are not a key', () => armoured('PRIVATE KEY', [0x02, 0x01, 0x00]), appId],
    [
      'PKCS #1 armour around a structure too short to be a key',
      () => armoured('RSA PRIVATE KEY', [0x30, 0x03, 0x02, 0x01, 0x00]),
      appId,
    ],
    ['two keys in one file', () => `${privateKey}${privateKey}`, appId],
  ])('is refused when it is %s', async (_case, text, named) => {
    expect(await keyFileReadOf(text(), pem, named)).toBeUndefined();
  });

  it('reads a key file of the default format by its pointers', async () => {
    expect(await keyFileReadOf(fileOf({}), pointers, appId)).toEqual({ clientId, privateKey });
  });

  it('is taken at the most bytes it may take, given here as its own size, and refused one byte past them', async () => {
    const bytes = new TextEncoder().encode(privateKey).byteLength;

    expect(await pemKeyOf(privateKey, bytes)).toBe(privateKey);
    expect(await pemKeyOf(privateKey, bytes - 1)).toBeUndefined();
  });
});
