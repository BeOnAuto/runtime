import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { Redacted } from 'effect';

import { valueAfter, type DeclaredProof, type PresentedProof, type ProofCase, type ProofCheck } from './proof-parts.ts';
import { bytesOfBase64, timestampText, withinTheWindow } from './standard-webhooks.ts';

type Hash = NonNullable<DeclaredProof['hash']>;

type Encoding = NonNullable<DeclaredProof['encoding']>;

interface DeclaredHmac {
  readonly hash: Hash;
  readonly encoding: Encoding;
  readonly signedPayload: string;
  readonly prefix: string | undefined;
}

interface SignedValues {
  readonly timestamp: string | undefined;
  readonly id: string | undefined;
}

interface PresentedHmac {
  readonly hash: Hash;
  readonly signature: Readonly<Uint8Array>;
  readonly timestamp: string | undefined;
  readonly signed: readonly Readonly<Uint8Array>[];
}

const macBytes: Readonly<Record<Hash, number>> = { sha256: 32, sha384: 48, sha512: 64 };

const hexText = /^(?:[0-9A-Fa-f]{2})+$/u;

const placeholders = /(\{(?:payload|timestamp|id)\})/u;

const payloadPlaceholder = '{payload}';

const utf8 = new TextEncoder();

function bytesOfHex(text: string): Uint8Array | undefined {
  return hexText.test(text) ? Uint8Array.from(Buffer.from(text, 'hex')) : undefined;
}

const bytesWritten: Readonly<Record<Encoding, (text: string) => Uint8Array | undefined>> = {
  hex: bytesOfHex,
  base64: bytesOfBase64,
};

function declaredHmacOf({
  hash,
  encoding,
  signed_payload: signedPayload,
  prefix,
}: DeclaredProof): DeclaredHmac | undefined {
  return hash === undefined || encoding === undefined || signedPayload === undefined
    ? undefined
    : { hash, encoding, signedPayload, prefix };
}

function signatureIn({ hash, encoding, prefix }: DeclaredHmac, presented: string | undefined): Uint8Array | undefined {
  const written = valueAfter(prefix, presented);
  const bytes = written === undefined ? undefined : bytesWritten[encoding](written);
  return bytes?.length === macBytes[hash] ? bytes : undefined;
}

function timestampTextOf(timestamp: string | number): string | undefined {
  const text = typeof timestamp === 'number' ? String(timestamp) : timestamp;
  return timestampText.test(text) ? text : undefined;
}

function signedPiecesOf(
  signedPayload: string,
  { timestamp, id }: SignedValues,
  body: Readonly<Uint8Array>,
): readonly Readonly<Uint8Array>[] | undefined {
  const parts = signedPayload.split(placeholders);
  if (parts.filter((part) => part === payloadPlaceholder).length !== 1) {
    return undefined;
  }
  const named: Readonly<Record<string, string | undefined>> = { '{timestamp}': timestamp, '{id}': id };
  const pieces = parts.flatMap((part): readonly Readonly<Uint8Array>[] => {
    if (part === payloadPlaceholder) {
      return [body];
    }
    const text = Object.hasOwn(named, part) ? named[part] : part;
    return text === undefined ? [] : [utf8.encode(text)];
  });
  return pieces.length === parts.length ? pieces : undefined;
}

function presentedHmacOf(
  declared: DeclaredHmac,
  { signature, timestamp, id }: PresentedProof,
  body: Readonly<Uint8Array>,
): PresentedHmac | 'unsigned' {
  const bytes = signatureIn(declared, signature);
  const time = timestamp === undefined ? undefined : timestampTextOf(timestamp);
  const signed = signedPiecesOf(declared.signedPayload, { timestamp: time, id }, body);
  if (bytes === undefined || signed === undefined || (timestamp !== undefined && time === undefined)) {
    return 'unsigned';
  }
  return { hash: declared.hash, signature: bytes, timestamp: time, signed };
}

function macOf(hash: Hash, secret: Redacted.Redacted, signed: readonly Readonly<Uint8Array>[]): Buffer {
  const mac = createHmac(hash, Redacted.value(secret));
  for (const piece of signed) {
    mac.update(piece);
  }
  return mac.digest();
}

export function hmacOf(declared: DeclaredProof, secret: Redacted.Redacted, text: string): string | undefined {
  const { hash, encoding } = declared;
  return hash === undefined || encoding === undefined
    ? undefined
    : macOf(hash, secret, [utf8.encode(text)]).toString(encoding);
}

export function hmacCheckOf({ declared, presented, secrets, body, nowMs }: ProofCase): ProofCheck {
  const hmac = declaredHmacOf(declared);
  const proof = hmac === undefined ? 'unsigned' : presentedHmacOf(hmac, presented, body);
  if (proof === 'unsigned') {
    return proof;
  }
  if (proof.timestamp !== undefined && !withinTheWindow(Number(proof.timestamp), nowMs)) {
    return 'stale';
  }
  return secrets.some((secret) => timingSafeEqual(macOf(proof.hash, secret, proof.signed), proof.signature))
    ? 'proven'
    : 'mismatched';
}
