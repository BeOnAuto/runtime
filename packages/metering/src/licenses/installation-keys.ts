import { ed25519PublicX } from './claim-values.ts';

export interface InstallationPublicKey {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly x: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const publicFields = new Set(['kty', 'crv', 'x']);

export function readInstallationPublicKey(value: unknown): InstallationPublicKey {
  if (
    !isRecord(value) ||
    value['kty'] !== 'OKP' ||
    value['crv'] !== 'Ed25519' ||
    Object.keys(value).some((key) => !publicFields.has(key))
  ) {
    throw new RangeError('An installation public key must be Ed25519 and contain only public coordinates');
  }
  return { kty: 'OKP', crv: 'Ed25519', x: ed25519PublicX(value['x']) };
}

export async function installationKeyFingerprint(value: unknown): Promise<string> {
  const key = readInstallationPublicKey(value);
  const canonical = JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x });
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
