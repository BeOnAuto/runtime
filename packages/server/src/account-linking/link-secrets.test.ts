import { describe, expect, it } from 'vitest';

import { aLinkCodeKey } from '../testing/account-linking/account-links-in-memory.ts';
import {
  aCode,
  aLinkValue,
  codeAlphabet,
  codeIn,
  codeLength,
  isTheSameSecret,
  keyedHashUnder,
  secretOf,
} from './link-secrets.ts';

function drawnAt(places: readonly number[]) {
  const asked: number[] = [];
  return {
    asked,
    drawn: (below: number) => {
      asked.push(below);
      return places[asked.length - 1] ?? 0;
    },
  };
}

describe('the code a person sends back', () => {
  it('is six letters of the twenty consonants RFC 8628 gives for a code a person types, as it ships', () => {
    expect([codeLength, codeAlphabet, codeAlphabet.length]).toEqual([6, 'BCDFGHJKLMNPQRSTVWXZ', 20]);
  });

  it('takes each letter at the place the random source draws below the size of the alphabet', () => {
    const drawing = drawnAt([0, 19, 1, 18, 9, 10]);

    const code = aCode(drawing.drawn);

    expect([code, drawing.asked]).toEqual(['BZCXMN', [20, 20, 20, 20, 20, 20]]);
  });

  it('is drawn from the cryptographic source by default', () => {
    expect(aCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{6}$/u);
  });

  it.each([
    ['BCDFGH', 'BCDFGH'],
    ['  bcdfgh\n', 'BCDFGH'],
    ['bCdFgH', 'BCDFGH'],
    ['BCDFG', undefined],
    ['BCDFGHJ', undefined],
    ['BCDFGA', undefined],
    ['BCD FGH', undefined],
    ['BCD-FG', undefined],
    ['BCDFG0', undefined],
    ['ÇCDFGH', undefined],
    ['', undefined],
  ])('is read from %j as %j, its whole text and nothing else', (text, read) => {
    expect(codeIn(text)).toBe(read);
  });
});

describe('the value of a link to an account', () => {
  it('is 32 random bytes in base64url, a new one each time', () => {
    const [one, another] = [aLinkValue(), aLinkValue()];

    expect([one, another].map((value) => /^[\w-]{43}$/u.test(value))).toEqual([true, true]);
    expect(one).not.toBe(another);
  });
});

describe('the secret a store keeps of a value or a code', () => {
  it('is its SHA-256 in hexadecimal, never the value itself', () => {
    expect(secretOf('BCDFGH')).toMatch(/^[0-9a-f]{64}$/u);
    expect(secretOf('BCDFGH')).not.toBe(secretOf('BCDFGJ'));
  });
});

describe('the secret a store keeps of a code', () => {
  it('is its HMAC-SHA256 under the server’s key, the same for every server holding that key, another under another key, and never its plain SHA-256', () => {
    const [one, again, another] = [aLinkCodeKey(1), aLinkCodeKey(1), aLinkCodeKey(2)].map((key) =>
      keyedHashUnder(key)?.of('BCDFGH'),
    );

    expect(one).toMatch(/^[0-9a-f]{64}$/u);
    expect([one === again, one === another, one === secretOf('BCDFGH')]).toEqual([true, false, false]);
  });

  it.each([
    ['no key', undefined],
    ['a key of 31 bytes', aLinkCodeKey(1, 31)],
    ['a key of 33 bytes', aLinkCodeKey(1, 33)],
  ])('is not made with %s, so no code is kept or compared', (_case, key) => {
    expect(keyedHashUnder(key)).toBeUndefined();
  });
});

describe('two secrets compared', () => {
  it.each([
    ['the same', 'a1b2', 'a1b2', true],
    ['of the same length, differing', 'a1b2', 'a1b3', false],
    ['of different lengths', 'a1b2', 'a1b2c3', false],
  ])('are %s, compared in constant time', (_case, one, other, same) => {
    expect(isTheSameSecret(one, other)).toBe(same);
  });
});
