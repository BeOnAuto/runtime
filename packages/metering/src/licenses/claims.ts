import { TARIFF_VERSION } from '../tariff/resources.ts';
import {
  licenseCapabilities,
  licenseDigest,
  licenseIdentifier,
  licenseInteger,
  licenseIssuer,
  licenseMode,
  licensePlan,
  licenseReferences,
  licenseRing,
  licenseTime,
  licenseVersions,
  numericDate,
} from './claim-values.ts';
import {
  LICENSE_AUDIENCE,
  LICENSE_POLICY_VERSION,
  LICENSE_VERSION,
  STANDARD_OFFLINE_MILLISECONDS,
  type LicenseEntitlement,
} from './entitlements.ts';

const versions = {
  version: LICENSE_VERSION,
  aud: LICENSE_AUDIENCE,
  tariffVersion: TARIFF_VERSION,
  policyVersion: LICENSE_POLICY_VERSION,
  development: 'cloud-only',
  reporting: 'cumulative.v1',
};

function validMode(entitlement: LicenseEntitlement): void {
  if (entitlement.mode === 'enterprise-offline' && entitlement.plan !== 'enterprise') {
    throw new RangeError('An offline enterprise package requires an Enterprise plan');
  }
}

function validTimes(entitlement: LicenseEntitlement): void {
  const { issuedAt, notBefore, expiresAt, refreshAfter, offlineDeadline, mode } = entitlement;
  const maximumLifetime = mode === 'standard' ? STANDARD_OFFLINE_MILLISECONDS : 366 * 86_400_000;
  if (notBefore > issuedAt || expiresAt <= issuedAt || expiresAt - issuedAt > maximumLifetime) {
    throw new RangeError('The license validity exceeds its allowed lifetime');
  }
  if (refreshAfter <= issuedAt || offlineDeadline < refreshAfter || offlineDeadline > expiresAt) {
    throw new RangeError('License refresh and offline deadlines must fit its validity');
  }
  if (mode === 'standard' && refreshAfter - issuedAt > 86_400_000) {
    throw new RangeError('A standard license requires daily refresh');
  }
  validMode(entitlement);
}

export function readLicenseClaims(claims: Readonly<Record<string, unknown>>): LicenseEntitlement {
  licenseVersions(claims, versions);
  const entitlement: LicenseEntitlement = {
    issuer: licenseIssuer(claims['iss']),
    accountId: licenseIdentifier(claims['sub']),
    customerId: licenseIdentifier(claims['customerId']),
    licenseId: licenseIdentifier(claims['licenseId']),
    installationId: licenseIdentifier(claims['installationId']),
    clusterId: licenseIdentifier(claims['clusterId']),
    installationKeyDigest: licenseDigest(claims['installationKeyDigest']),
    serial: licenseIdentifier(claims['jti']),
    ring: licenseRing(claims['ring']),
    plan: licensePlan(claims['plan']),
    mode: licenseMode(claims['mode']),
    generation: licenseInteger(claims['generation']),
    issuedAt: licenseTime(claims['iat']),
    notBefore: licenseTime(claims['nbf']),
    expiresAt: licenseTime(claims['exp']),
    refreshAfter: licenseTime(claims['refreshAfter']),
    offlineDeadline: licenseTime(claims['offlineDeadline']),
    capabilities: licenseCapabilities(claims['capabilities']),
    allocationIds: licenseReferences(claims['allocationIds']),
    grantIds: licenseReferences(claims['grantIds']),
  };
  validTimes(entitlement);
  return entitlement;
}

export function licenseClaims(entitlement: LicenseEntitlement): Readonly<Record<string, unknown>> {
  const claims = {
    ...versions,
    iss: entitlement.issuer,
    sub: entitlement.accountId,
    customerId: entitlement.customerId,
    licenseId: entitlement.licenseId,
    installationId: entitlement.installationId,
    clusterId: entitlement.clusterId,
    installationKeyDigest: entitlement.installationKeyDigest,
    jti: entitlement.serial,
    ring: entitlement.ring,
    plan: entitlement.plan,
    mode: entitlement.mode,
    generation: entitlement.generation,
    iat: numericDate(entitlement.issuedAt),
    nbf: numericDate(entitlement.notBefore),
    exp: numericDate(entitlement.expiresAt),
    refreshAfter: numericDate(entitlement.refreshAfter),
    offlineDeadline: numericDate(entitlement.offlineDeadline),
    capabilities: entitlement.capabilities,
    allocationIds: entitlement.allocationIds,
    grantIds: entitlement.grantIds,
  };
  readLicenseClaims(claims);
  return claims;
}
