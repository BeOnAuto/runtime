import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Redacted } from 'effect';

export const webhookHeaders = {
  id: 'webhook-id',
  timestamp: 'webhook-timestamp',
  signature: 'webhook-signature',
} as const;

export const signingSecretPrefix = 'whsec_';

export const signingKeyBytes = { fewest: 24, most: 64, made: 32 } as const;

export const webhookToleranceSeconds = 5 * 60;

const mostSignatureHeaderBytes = 2048;

const signatureVersion = 'v1';

const signatureBytes = 32;

const base64Text = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const webhookIdText = /^[\u0021-\u002B\u002D\u002F-\u007E]{1,256}$/u;

const timestampText = /^[1-9]\d{0,11}$/u;

export type SigningKey = Redacted.Redacted<Uint8Array>;

export type HeaderOf = (name: string) => string | null | undefined;

export interface PresentedWebhook {
  readonly id: string;
  readonly timestamp: number;
  readonly signatures: readonly Readonly<Uint8Array>[];
}

export type WebhookRefusal = 'unsigned' | 'stale';

function bytesOfBase64(text: string): Uint8Array | undefined {
  return text !== '' && base64Text.test(text) ? Uint8Array.from(Buffer.from(text, 'base64')) : undefined;
}

export function signingKeyOf(secret: string): SigningKey | undefined {
  const key = secret.startsWith(signingSecretPrefix)
    ? bytesOfBase64(secret.slice(signingSecretPrefix.length))
    : undefined;
  return key !== undefined && key.length >= signingKeyBytes.fewest && key.length <= signingKeyBytes.most
    ? Redacted.make(key)
    : undefined;
}

export function madeSigningSecret(): Redacted.Redacted {
  return Redacted.make(`${signingSecretPrefix}${randomBytes(signingKeyBytes.made).toString('base64')}`);
}

function macOf(key: SigningKey, id: string, timestamp: number, body: Readonly<Uint8Array>): Buffer {
  return createHmac('sha256', Redacted.value(key)).update(`${id}.${timestamp}.`).update(body).digest();
}

export function webhookSignatureOf(key: SigningKey, id: string, timestamp: number, body: Readonly<Uint8Array>): string {
  return `${signatureVersion},${macOf(key, id, timestamp, body).toString('base64')}`;
}

function signaturesIn(header: string): readonly Readonly<Uint8Array>[] {
  return header.split(' ').flatMap((entry) => {
    const [version, value = ''] = entry.split(',', 2);
    const bytes = version === signatureVersion ? bytesOfBase64(value) : undefined;
    return bytes?.length === signatureBytes ? [bytes] : [];
  });
}

function withinTheWindow(timestamp: number, nowMs: number): boolean {
  return Math.abs(Math.floor(nowMs / 1000) - timestamp) <= webhookToleranceSeconds;
}

export function presentedWebhookOf(header: HeaderOf, nowMs: number): PresentedWebhook | WebhookRefusal {
  const id = header(webhookHeaders.id) ?? '';
  const timestamp = header(webhookHeaders.timestamp) ?? '';
  const signature = header(webhookHeaders.signature) ?? '';
  if (!webhookIdText.test(id) || !timestampText.test(timestamp)) {
    return 'unsigned';
  }
  const signatures = Buffer.byteLength(signature) > mostSignatureHeaderBytes ? [] : signaturesIn(signature);
  if (signatures.length === 0) {
    return 'unsigned';
  }
  return withinTheWindow(Number(timestamp), nowMs) ? { id, timestamp: Number(timestamp), signatures } : 'stale';
}

export function isSignedByAnyOf(
  keys: readonly SigningKey[],
  presented: PresentedWebhook,
  body: Readonly<Uint8Array>,
): boolean {
  const { id, timestamp, signatures } = presented;
  return keys.some((key) => {
    const expected = macOf(key, id, timestamp, body);
    return signatures.some((signature) => timingSafeEqual(expected, signature));
  });
}
