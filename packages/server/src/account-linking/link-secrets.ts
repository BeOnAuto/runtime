import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

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

function bytesOf(key: Redacted.Redacted<Uint8Array> | undefined): Uint8Array | undefined {
  const bytes = key === undefined ? undefined : Redacted.value(key);
  return bytes?.length === secretKeyBytes ? bytes : undefined;
}

function hashedUnder(bytes: Readonly<Uint8Array>): KeyedHash {
  return { of: (code) => createHmac('sha256', bytes).update(code).digest('hex') };
}

export function keyedHashUnder(key: Redacted.Redacted<Uint8Array> | undefined): KeyedHash | undefined {
  const bytes = bytesOf(key);
  return bytes === undefined ? undefined : hashedUnder(bytes);
}

interface CodeSeal {
  readonly sealed: (code: string) => string;
  readonly opened: (sealed: string) => string | undefined;
}

const sealing = 'aes-256-gcm';

const sealIvBytes = 12;

const sealTagBytes = 16;

const sealPurpose = 'account linking: the code kept sealed in the browser it was shown in';

function sealedUnder(key: Redacted.Redacted<Uint8Array>, code: string): string {
  const iv = randomBytes(sealIvBytes);
  const cipher = createCipheriv(sealing, Redacted.value(key), iv, { authTagLength: sealTagBytes });
  const sealed = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${sealed.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

const aSeal = /^(?<iv>[\w-]+)\.(?<text>[\w-]+)\.(?<tag>[\w-]+)$/u;

function partOf(parts: Readonly<Record<string, string>>, name: 'iv' | 'text' | 'tag'): Buffer {
  return Buffer.from(String(parts[name]), 'base64url');
}

function openedUnder(key: Redacted.Redacted<Uint8Array>, sealed: string): string | undefined {
  const parts = aSeal.exec(sealed)?.groups;
  if (parts === undefined) {
    return undefined;
  }
  try {
    const decipher = createDecipheriv(sealing, Redacted.value(key), partOf(parts, 'iv'), {
      authTagLength: sealTagBytes,
    });
    decipher.setAuthTag(partOf(parts, 'tag'));
    return Buffer.concat([decipher.update(partOf(parts, 'text')), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

function codeSealUnder(bytes: Readonly<Uint8Array>): CodeSeal {
  const key = Redacted.make(new Uint8Array(hkdfSync('sha256', bytes, new Uint8Array(0), sealPurpose, secretKeyBytes)));
  return { sealed: (code) => sealedUnder(key, code), opened: (sealed) => openedUnder(key, sealed) };
}

export interface LinkCodeKeys {
  readonly hashed: KeyedHash;
  readonly seal: CodeSeal;
}

export function linkCodeKeysUnder(key: Redacted.Redacted<Uint8Array> | undefined): LinkCodeKeys | undefined {
  const bytes = bytesOf(key);
  return bytes === undefined ? undefined : { hashed: hashedUnder(bytes), seal: codeSealUnder(bytes) };
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
