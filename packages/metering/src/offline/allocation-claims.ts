import {
  licenseDigest,
  licenseIdentifier,
  licenseInteger,
  licenseIssuer,
  licenseMode,
  licenseRing,
  licenseVersions,
} from '../licenses/claim-values.ts';
import { LICENSE_POLICY_VERSION, STANDARD_OFFLINE_MILLISECONDS } from '../licenses/entitlements.ts';
import { checkedCreditUnits, creditUnitsFromWire } from '../quantities/credits.ts';
import { TARIFF_VERSION } from '../tariff/resources.ts';
import type { AllocatedSource, OfflineAllocation } from './allocations.ts';
import { offlineList, offlineRecord, offlineSource, offlineTime } from './values.ts';

const versions = {
  version: 'auto.offline-allocation.v1',
  audience: 'auto-runtime-offline',
  tariffVersion: TARIFF_VERSION,
  policyVersion: LICENSE_POLICY_VERSION,
  funding: 'platform',
};

function allocatedSource(value: unknown): AllocatedSource {
  const source = offlineRecord(value);
  if (typeof source['units'] !== 'string') throw new RangeError('Allocated quantities must use decimal strings');
  return {
    lotId: licenseIdentifier(source['lotId']),
    source: offlineSource(source['source']),
    issuedAt: offlineTime(source['issuedAt']),
    expiresAt: offlineTime(source['expiresAt']),
    units: creditUnitsFromWire(source['units']),
  };
}

function validAllocation(allocation: OfflineAllocation): void {
  const maximum = allocation.mode === 'standard' ? STANDARD_OFFLINE_MILLISECONDS : 366 * 86_400_000;
  if (allocation.expiresAt <= allocation.issuedAt || allocation.expiresAt - allocation.issuedAt > maximum) {
    throw new RangeError('The offline allocation exceeds its permitted lifetime');
  }
  if (
    allocation.epoch === 0 ||
    new Set(allocation.sources.map((source) => source.lotId)).size !== allocation.sources.length
  ) {
    throw new RangeError('An offline allocation needs a positive epoch and distinct source lots');
  }
  let total = 0n;
  for (const source of allocation.sources) {
    if (source.units === 0n || source.issuedAt > allocation.issuedAt || source.expiresAt <= allocation.issuedAt) {
      throw new RangeError('An offline source must contain positive, currently valid capacity');
    }
    total = checkedCreditUnits(total + source.units);
  }
}

export function readAllocationClaims(value: unknown): OfflineAllocation {
  const claims = offlineRecord(value);
  licenseVersions(claims, versions);
  const allocation: OfflineAllocation = {
    issuer: licenseIssuer(claims['issuer']),
    ring: licenseRing(claims['ring']),
    accountId: licenseIdentifier(claims['accountId']),
    installationId: licenseIdentifier(claims['installationId']),
    clusterId: licenseIdentifier(claims['clusterId']),
    installationKeyDigest: licenseDigest(claims['installationKeyDigest']),
    id: licenseIdentifier(claims['id']),
    epoch: licenseInteger(claims['epoch']),
    mode: licenseMode(claims['mode']),
    issuedAt: offlineTime(claims['issuedAt']),
    expiresAt: offlineTime(claims['expiresAt']),
    sources: offlineList(claims['sources'], 64).map((source) => allocatedSource(source)),
  };
  validAllocation(allocation);
  return allocation;
}

export function allocationPayload(allocation: OfflineAllocation): string {
  const claims = {
    ...versions,
    issuer: allocation.issuer,
    ring: allocation.ring,
    accountId: allocation.accountId,
    installationId: allocation.installationId,
    clusterId: allocation.clusterId,
    installationKeyDigest: allocation.installationKeyDigest,
    id: allocation.id,
    epoch: allocation.epoch,
    mode: allocation.mode,
    issuedAt: allocation.issuedAt,
    expiresAt: allocation.expiresAt,
    sources: allocation.sources.map((source) => ({
      lotId: source.lotId,
      source: source.source,
      issuedAt: source.issuedAt,
      expiresAt: source.expiresAt,
      units: String(source.units),
    })),
  };
  readAllocationClaims(claims);
  return JSON.stringify(claims);
}
