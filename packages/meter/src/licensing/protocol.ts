import { licenseVerifier, type InstallationChallenge } from '@on.auto/metering';

import { assertEntitlementResponse, readLicenseBundle } from './bundle.ts';
import { assertChallengeAuthority, challengeForRequest } from './challenge.ts';
import type { LicenseProtocol, LicenseProtocolOptions } from './records.ts';
import { freshLicenseTime } from './time.ts';
import { licenseTransport } from './transport.ts';

export function licenseProtocol(options: LicenseProtocolOptions): LicenseProtocol {
  const { installation } = options;
  const trust = { ...options.trust, keys: options.trust.keys.map((key) => ({ ...key })) };
  const verify = licenseVerifier(trust);
  const send = licenseTransport(trust.issuer, options.fetch);
  const challengeRead = async (value: unknown, requestId: string, purpose: InstallationChallenge['purpose']) => {
    const challenge = await challengeForRequest(value, { requestId, purpose });
    assertChallengeAuthority(challenge, trust, installation);
    return challenge;
  };
  return {
    freshTime: freshLicenseTime(trust, send, options.monotonicTime),
    activationChallenge: async (requestId, activationKey) =>
      challengeRead(
        await send('/licenses/activation-challenge', {
          requestId,
          activationKey,
          clusterId: installation.clusterId,
          publicKey: installation.publicKey,
        }),
        requestId,
        'activate',
      ),
    refreshChallenge: async (requestId, installationId) => {
      const challenge = await challengeRead(
        await send('/licenses/refresh-challenge', { requestId, installationId }),
        requestId,
        'refresh',
      );
      if (challenge.installationId !== installationId) throw new Error('license_challenge_mismatch');
      return challenge;
    },
    complete: async (challenge, currentTime) => {
      assertChallengeAuthority(challenge, trust, installation);
      const proof = await installation.proveChallenge(challenge);
      const bundle = readLicenseBundle(await send('/licenses/complete', { challengeId: challenge.id, proof }));
      const license = await verify(bundle.entitlementToken, {
        binding: challenge,
        now: await currentTime(),
        minimumGeneration: challenge.generation + 1,
      });
      await assertEntitlementResponse(license, challenge, bundle.allocationTokens);
      return { ...bundle, license };
    },
  };
}
