import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Data } from 'effect';

const algorithm = 'aes-256-gcm';

const keyBytes = 32;

const ivBytes = 12;

const tagBytes = 16;

export class SealedTextRefused extends Data.TaggedError('sealed_text_refused')<{ readonly message: string }> {}

const notOpened = (): SealedTextRefused =>
  new SealedTextRefused({ message: 'A sealed text does not open under this key for this row' });

export type RowBinding = readonly [
  table: string,
  conversation: string,
  sequence: number,
  author: string,
  sender: string | null,
];

export function aConversationKey(): string {
  return randomBytes(keyBytes).toString('base64');
}

function keyIn(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.byteLength !== keyBytes) {
    throw new SealedTextRefused({ message: `A conversation's key is ${bytes.byteLength} bytes, not ${keyBytes}` });
  }
  return bytes;
}

const boundTo = (row: RowBinding): Buffer => Buffer.from(JSON.stringify(row));

export function sealedFor(key: string, row: RowBinding, text: string): string {
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv(algorithm, keyIn(key), iv, { authTagLength: tagBytes });
  cipher.setAAD(boundTo(row));
  const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${sealed.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

function openedWith(key: string, row: RowBinding, [iv, text, tag]: readonly [string, string, string]): string {
  const decipher = createDecipheriv(algorithm, keyIn(key), Buffer.from(iv, 'base64url'), { authTagLength: tagBytes });
  decipher.setAAD(boundTo(row));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(text, 'base64url')), decipher.final()]).toString('utf8');
}

export function openedFor(key: string, row: RowBinding, sealed: string): string {
  keyIn(key);
  const parts = sealed.split('.');
  const [iv = '', text = '', tag = ''] = parts;
  if (parts.length !== 3) {
    throw notOpened();
  }
  try {
    return openedWith(key, row, [iv, text, tag]);
  } catch {
    throw notOpened();
  }
}
