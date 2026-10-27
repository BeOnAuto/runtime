import {
  licenseEntitlementSerial,
  MOST_ALLOCATION_TOKEN_CHARACTERS,
  type InstallationChallenge,
  type LicenseEntitlement,
} from '@on.auto/metering';
import { Schema } from 'effect';

const responseBody = Schema.decodeUnknownSync(
  Schema.Struct({ entitlementToken: Schema.String, allocationTokens: Schema.Array(Schema.String) }),
);

export function readLicenseBundle(value: unknown) {
  const body = responseBody(value);
  if (
    body.allocationTokens.length > 64 ||
    body.allocationTokens.some((token) => token.length === 0 || token.length > MOST_ALLOCATION_TOKEN_CHARACTERS) ||
    new Set(body.allocationTokens).size !== body.allocationTokens.length
  )
    throw new Error('license_bundle_invalid');
  return body;
}

export async function assertEntitlementResponse(
  license: LicenseEntitlement,
  challenge: InstallationChallenge,
  allocationTokens: readonly string[],
): Promise<void> {
  if (
    license.serial !== (await licenseEntitlementSerial(challenge.accountId, challenge.id)) ||
    license.generation !== challenge.generation + 1 ||
    license.licenseId !== challenge.licenseId
  )
    throw new Error('license_response_mismatch');
  if (
    license.issuedAt + 999 < challenge.createdAt ||
    license.issuedAt >= challenge.expiresAt ||
    allocationTokens.length !== license.allocationIds.length
  )
    throw new Error('license_response_mismatch');
}
