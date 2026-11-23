import { Buffer } from 'node:buffer';

const pemBlock =
  /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\n-----END (RSA PRIVATE KEY|PRIVATE KEY)-----$/u;

const sequenceTag = 0x30;

const octetStringTag = 0x04;

const versionZero = Buffer.from([0x02, 0x01, 0x00]);

const rsaEncryptionIdentifier = Buffer.from([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

const shortLengthPast = 0x80;

const byteValues = 0x100;

const pemLineCharacters = 64;

function lengthBytesOf(length: number): Buffer {
  if (length < shortLengthPast) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / byteValues)) {
    bytes.unshift(rest % byteValues);
  }
  return Buffer.from([shortLengthPast + bytes.length, ...bytes]);
}

function encodedAs(tag: number, content: Readonly<Buffer>): Buffer {
  return Buffer.concat([Buffer.from([tag]), lengthBytesOf(content.length), content]);
}

function privateKeyInfoOf(rsaPrivateKey: Readonly<Buffer>): Buffer {
  return encodedAs(
    sequenceTag,
    Buffer.concat([versionZero, rsaEncryptionIdentifier, encodedAs(octetStringTag, rsaPrivateKey)]),
  );
}

function pemOf(der: Readonly<Buffer>): string {
  const text = der.toString('base64');
  const lines = Array.from({ length: Math.ceil(text.length / pemLineCharacters) }, (_, index) =>
    text.slice(index * pemLineCharacters, (index + 1) * pemLineCharacters),
  );
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
}

export function pkcs8Of(text: string): string | undefined {
  const [, label, body = '', closing] = pemBlock.exec(text.trim()) ?? [];
  const der = Buffer.from(body.replaceAll(/\s/gu, ''), 'base64');
  if (label === undefined || label !== closing || der.length === 0 || der[0] !== sequenceTag) {
    return undefined;
  }
  return pemOf(label === 'PRIVATE KEY' ? der : privateKeyInfoOf(der));
}
