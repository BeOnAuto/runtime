import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { uuidV5 } from './uuid-v5.ts';

const dns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function byNodeCrypto(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.toString('hex', 0, 16);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

describe('a UUID version 5', () => {
  it('is the one RFC 9562 gives for a name in a namespace', () => {
    expect(uuidV5(dns, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('is the SHA-1 of the namespace and the name in UTF-8, marked as version 5, for names of every length', () => {
    const names = ['', 'a', 'é', '😀 run', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)];
    const namespace = randomUUID();

    expect(names.map((name) => uuidV5(namespace, name))).toEqual(names.map((name) => byNodeCrypto(namespace, name)));
  });
});
