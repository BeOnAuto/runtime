import { compactVerify } from 'jose';

import { licenseIdentifier } from '../licenses/claim-values.ts';
import type { LicenseTrust } from '../licenses/entitlements.ts';
import { trustedKeys } from '../licenses/trust.ts';
import {
  LICENSE_TIME_TYPE,
  MOST_TIME_TOKEN_CHARACTERS,
  licenseTimePayload,
  readTimeAttestation,
  type LicenseTimeAttestation,
} from './attestations.ts';

export function licenseTimeVerifier(
  trust: LicenseTrust,
): (token: string, requestId: string) => Promise<LicenseTimeAttestation> {
  const keySet = trustedKeys(trust);
  const { issuer, ring } = trust;
  return async (token, requestId) => {
    licenseIdentifier(requestId);
    if (token.length > MOST_TIME_TOKEN_CHARACTERS)
      throw new RangeError('The license time token exceeds its size bound');
    const { protectedHeader, payload } = await compactVerify(token, keySet, { algorithms: ['EdDSA'] });
    if (protectedHeader.typ !== LICENSE_TIME_TYPE || protectedHeader.kid === undefined)
      throw new RangeError('The license time must name its dedicated type and trusted signing key');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload);
    const claims: unknown = JSON.parse(text);
    const attestation = readTimeAttestation(claims);
    if (text !== licenseTimePayload(attestation)) throw new RangeError('The signed license time must be canonical');
    if (attestation.issuer !== issuer || attestation.ring !== ring || attestation.requestId !== requestId)
      throw new RangeError('The license time belongs to another authority, ring or request');
    return attestation;
  };
}
