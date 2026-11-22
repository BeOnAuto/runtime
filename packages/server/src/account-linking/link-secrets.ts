import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { sha256Of } from '@on.auto/content';
import { secretKeyBytes } from '@on.auto/secrets';
import { Redacted } from 'effect';

export const codeAlphabet = 'BCDFGHJKLMNPQRSTVWXZ';

export const codeLength = 6;

const randomBytesOfALinkValue = 32;

type Drawn = (below: number) => number;

export function aLinkValue(): string {
  return randomBytes(randomBytesOfALinkValue).toString('base64url');
}

export function aCode(drawn: Drawn = randomInt): string {
  return Array.from({ length: codeLength }, () => codeAlphabet.charAt(drawn(codeAlphabet.length))).join('');
}

export function secretOf(value: string): string {
  return sha256Of(value);
}

export interface KeyedHash {
  readonly of: (code: string) => string;
}

export function keyedHashUnder(key: Redacted.Redacted<Uint8Array> | undefined): KeyedHash | undefined {
  const bytes = key === undefined ? undefined : Redacted.value(key);
  return bytes?.length === secretKeyBytes
    ? { of: (code) => createHmac('sha256', bytes).update(code).digest('hex') }
    : undefined;
}

export function isTheSameSecret(one: string, other: string): boolean {
  const [given, kept] = [Buffer.from(one), Buffer.from(other)];
  return given.length === kept.length && timingSafeEqual(given, kept);
}

function inUpperCase(text: string): string {
  return text.replaceAll(/[a-z]/gu, (letter) => letter.toUpperCase());
}

const aWholeCode = new RegExp(`^[${codeAlphabet}]{${String(codeLength)}}$`, 'u');

export function codeIn(text: string): string | undefined {
  const code = inUpperCase(text.trim());
  return aWholeCode.test(code) ? code : undefined;
}
