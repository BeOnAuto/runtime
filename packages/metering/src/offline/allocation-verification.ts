import { compactVerify } from 'jose';

import { licenseInteger } from '../licenses/claim-values.ts';
import type { LicenseTrust } from '../licenses/entitlements.ts';
import { trustedKeys } from '../licenses/trust.ts';
import { allocationPayload, readAllocationClaims } from './allocation-claims.ts';
import {
  MOST_ALLOCATION_TOKEN_CHARACTERS,
  OFFLINE_ALLOCATION_TYPE,
  type ExpectedAllocation,
  type OfflineAllocation,
} from './allocations.ts';
import { offlineTime } from './values.ts';

function assertScope(allocation: OfflineAllocation, expected: ExpectedAllocation, issuer: string, ring: string): void {
  const license = expected.license;
  if (
    allocation.issuer !== issuer ||
    allocation.ring !== ring ||
    license.issuer !== issuer ||
    license.ring !== ring ||
    allocation.accountId !== license.accountId ||
    allocation.installationId !== license.installationId ||
    allocation.clusterId !== license.clusterId ||
    allocation.installationKeyDigest !== license.installationKeyDigest
  ) {
    throw new RangeError('The offline allocation belongs to another authority or installation');
  }
}

function assertReferences(allocation: OfflineAllocation, expected: ExpectedAllocation): void {
  const license = expected.license;
  if (
    allocation.mode !== license.mode ||
    !license.allocationIds.includes(allocation.id) ||
    allocation.sources.some((source) => !license.grantIds.includes(source.lotId))
  ) {
    throw new RangeError('The license does not authorize this allocation and its source lots');
  }
}

function assertTime(allocation: OfflineAllocation, expected: ExpectedAllocation): void {
  const { license, now, minimumEpoch } = expected;
  if (
    allocation.issuedAt > now ||
    allocation.expiresAt <= now ||
    allocation.epoch < minimumEpoch ||
    license.notBefore > now ||
    license.issuedAt > now ||
    license.expiresAt <= now ||
    license.offlineDeadline <= now ||
    allocation.expiresAt > license.offlineDeadline
  ) {
    throw new RangeError('The offline allocation or license is stale or outside its trusted time');
  }
}

export function allocationVerifier(
  trust: LicenseTrust,
): (token: string, expected: ExpectedAllocation) => Promise<OfflineAllocation> {
  const keySet = trustedKeys(trust);
  const { issuer, ring } = trust;
  return async (token, expected) => {
    if (token.length > MOST_ALLOCATION_TOKEN_CHARACTERS)
      throw new RangeError('The allocation token exceeds its size bound');
    offlineTime(expected.now);
    licenseInteger(expected.minimumEpoch);
    const { protectedHeader, payload } = await compactVerify(token, keySet, { algorithms: ['EdDSA'] });
    if (protectedHeader.typ !== OFFLINE_ALLOCATION_TYPE || protectedHeader.kid === undefined) {
      throw new RangeError('The allocation must name its dedicated type and trusted signing key');
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload);
    const claims: unknown = JSON.parse(text);
    const allocation = readAllocationClaims(claims);
    if (text !== allocationPayload(allocation)) throw new RangeError('The signed allocation payload must be canonical');
    assertScope(allocation, expected, issuer, ring);
    assertReferences(allocation, expected);
    assertTime(allocation, expected);
    return allocation;
  };
}
