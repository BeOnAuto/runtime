import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostTokenBytes, verifiedPerson } from './token-verification.ts';

function segmentOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const header = segmentOf({ alg: 'RS256', kid: 'rs256-1', typ: 'at+jwt' });

const payload = segmentOf({ iss: 'https://login.example', aud: 'https://runtime.example', exp: 1, sub: 'ada' });

function tokenOf(length: number): string {
  return `${header}.${payload}.${'A'.repeat(length - header.length - payload.length - 2)}`;
}

const expected = {
  issuer: 'https://login.example',
  audiences: ['https://runtime.example'],
  pageOrigins: [],
  requestOrigin: undefined,
  now: 0,
};

describe('the length of a token', () => {
  it('is taken at 8 KiB, and a token one byte longer is refused before anything is decoded or asked of a key', async () => {
    const keysAsked: string[] = [];
    const keySet = (): Promise<never> => {
      keysAsked.push('asked');
      return Promise.reject(new TypeError('no key in this test'));
    };

    expect([tokenOf(mostTokenBytes).length, await verifiedPerson(tokenOf(mostTokenBytes), keySet, expected)]).toEqual([
      8192,
      Result.fail('it could not be verified'),
    ]);
    expect(await verifiedPerson(tokenOf(mostTokenBytes + 1), keySet, expected)).toEqual(
      Result.fail('it is longer than 8 KiB'),
    );
    expect(keysAsked).toEqual(['asked']);
  });
});
