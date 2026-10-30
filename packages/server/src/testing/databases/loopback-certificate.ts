import { generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';

import { onTestFinished } from 'vitest';

export interface LoopbackCertificate {
  readonly key: string;
  readonly cert: string;
}

const tags = {
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  utf8String: 0x0c,
  sequence: 0x30,
  set: 0x31,
  utcTime: 0x17,
  version: 0xa0,
  extensions: 0xa3,
  ipAddress: 0x87,
};

const day = 86_400_000;

function bytesOf(size: number): readonly number[] {
  return size === 0 ? [] : [...bytesOf(Math.floor(size / 256)), size % 256];
}

function lengthOf(size: number): readonly number[] {
  return size < 128 ? [size] : [128 + bytesOf(size).length, ...bytesOf(size)];
}

function element(tag: number, ...contents: readonly Readonly<Uint8Array>[]): Buffer {
  const body = Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag, ...lengthOf(body.length)]), body]);
}

const ecdsaWithSha256 = element(tags.sequence, Buffer.from('06082a8648ce3d040302', 'hex'));

const commonName = Buffer.from('0603550403', 'hex');

const subjectAltName = Buffer.from('0603551d11', 'hex');

function alternativeNameOf(address: string): Buffer {
  const octets = Buffer.from(address.split('.').map(Number));
  return element(
    tags.sequence,
    subjectAltName,
    element(tags.octetString, element(tags.sequence, element(tags.ipAddress, octets))),
  );
}

function nameOf(text: string): Buffer {
  return element(
    tags.sequence,
    element(tags.set, element(tags.sequence, commonName, element(tags.utf8String, Buffer.from(text)))),
  );
}

function utcTimeOf(time: number): Buffer {
  const digits = new Date(time).toISOString().replaceAll(/[-:T]/gu, '').slice(2, 14);
  return element(tags.utcTime, Buffer.from(`${digits}Z`));
}

export function aCertificateOfTheLoopback(address = '127.0.0.1'): LoopbackCertificate {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const name = nameOf('a test database');
  const now = Date.now();
  const toBeSigned = element(
    tags.sequence,
    element(tags.version, element(tags.integer, Buffer.from([2]))),
    element(tags.integer, Buffer.from([1])),
    ecdsaWithSha256,
    name,
    element(tags.sequence, utcTimeOf(now - day), utcTimeOf(now + day)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    element(tags.extensions, element(tags.sequence, alternativeNameOf(address))),
  );
  const signature = element(tags.bitString, Buffer.from([0]), sign('sha256', toBeSigned, privateKey));
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: new X509Certificate(element(tags.sequence, toBeSigned, ecdsaWithSha256, signature)).toString(),
  };
}

export function trustedForTheTest({ cert }: LoopbackCertificate): void {
  const trustedBefore = getCACertificates('default');
  setDefaultCACertificates([...trustedBefore, cert]);
  onTestFinished(() => {
    setDefaultCACertificates(trustedBefore);
  });
}
