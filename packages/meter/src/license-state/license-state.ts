import { installationProofPayload, licenseEntitlementSerial, licenseVerifier } from '@on.auto/metering';

import type { LicenseTime } from '../clock/records.ts';
import { prepareMeter } from '../database/schema.ts';
import { assertEntitlementResponse, readLicenseBundle } from '../licensing/bundle.ts';
import { assertChallengeAuthority } from '../licensing/challenge.ts';
import { readLicenseHead, readLicenseHistory } from './reading.ts';
import type {
  CurrentLicense,
  LicenseHead,
  LicenseHistory,
  LicenseRecordRequest,
  LicenseRecordResult,
  LicenseState,
  LicenseStateOptions,
} from './records.ts';
import { refuseLicense, writeLicense } from './writing.ts';

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('license_revision_invalid');
}

function existingReceipt(
  history: LicenseHistory | undefined,
  request: LicenseRecordRequest,
): LicenseRecordResult | undefined {
  if (history === undefined) return undefined;
  if (
    history.token !== request.entitlementToken ||
    history.challengePayload !== installationProofPayload(request.challenge) ||
    history.allocationJson !== JSON.stringify(request.allocationTokens)
  )
    throw new Error('license_response_conflict');
  return { status: 'existing', serial: history.serial, generation: history.generation, revision: history.revision };
}

function activeBinding(head: LicenseHead) {
  if (head.state !== 'active' || head.accountId === null || head.installationId === null || head.serial === null)
    throw new Error('license_not_active');
  return { accountId: head.accountId, installationId: head.installationId, serial: head.serial };
}

async function recordedLicense(
  options: LicenseStateOptions,
  request: LicenseRecordRequest,
  verify: ReturnType<typeof licenseVerifier>,
): Promise<LicenseRecordResult> {
  assertRevision(request.expectedRevision);
  assertChallengeAuthority(request.challenge, options.trust, options.installation);
  readLicenseBundle(request);
  const serial = await licenseEntitlementSerial(request.challenge.accountId, request.challenge.id);
  const existing = () =>
    readLicenseHistory(options.connection, serial).then((history) => existingReceipt(history, request));
  const previous = await existing();
  if (previous !== undefined) return previous;
  try {
    const before = await readLicenseHead(options.connection);
    const license = await verify(request.entitlementToken, {
      binding: {
        ...options.installation,
        accountId: before.accountId ?? request.challenge.accountId,
        installationId: before.installationId ?? request.challenge.installationId,
      },
      now: request.now,
      minimumGeneration: Math.max(before.generation, request.challenge.generation + 1),
    });
    await assertEntitlementResponse(license, request.challenge, request.allocationTokens);
    if (await writeLicense(options.connection, request, license))
      return { status: 'accepted', serial, generation: license.generation, revision: request.expectedRevision + 1 };
  } catch (error) {
    const recovered = await existing();
    if (recovered !== undefined) return recovered;
    throw error;
  }
  return (await existing()) ?? { status: 'conflict' };
}

async function currentLicense(
  options: LicenseStateOptions,
  time: LicenseTime,
  verify: ReturnType<typeof licenseVerifier>,
): Promise<CurrentLicense> {
  const { now, onlineRequired } = time;
  if (onlineRequired) throw new Error('license_clock_untrusted');
  const snapshot = await options.connection.readConsistently(async (read) => {
    const head = await readLicenseHead({ read });
    const binding = activeBinding(head);
    const history = await readLicenseHistory({ read }, binding.serial);
    if (history === undefined) throw new Error('license_history_unavailable');
    return { head, binding, history };
  });
  const license = await verify(snapshot.history.token, {
    binding: { ...options.installation, ...snapshot.binding },
    now,
    minimumGeneration: snapshot.head.generation,
  });
  if (license.serial !== snapshot.head.serial || license.generation !== snapshot.head.generation)
    throw new Error('license_projection_invalid');
  return { revision: snapshot.head.revision, license };
}

export async function openLicenseState(options: LicenseStateOptions): Promise<LicenseState> {
  const captured = {
    ...options,
    trust: { ...options.trust, keys: options.trust.keys.map((key) => ({ ...key })) },
    installation: { ...options.installation },
  };
  const verify = licenseVerifier(captured.trust);
  await prepareMeter(captured.connection);
  return {
    head: () => readLicenseHead(captured.connection),
    record: (request) =>
      recordedLicense(
        captured,
        { ...request, challenge: { ...request.challenge }, allocationTokens: [...request.allocationTokens] },
        verify,
      ),
    refuse: (revision) => {
      assertRevision(revision);
      return refuseLicense(captured.connection, revision);
    },
    current: (time) => currentLicense(captured, time, verify),
  };
}
