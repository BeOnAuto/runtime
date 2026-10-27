import { verifyInstallationProof, STANDARD_OFFLINE_MILLISECONDS } from '@on.auto/metering';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { licenseFixture } from '../testing/license-fixture.ts';

const completionBody = Schema.decodeUnknownSync(Schema.Struct({ challengeId: Schema.String, proof: Schema.String }));

describe('the installation license protocol', () => {
  it('activates with the public installation key, proves the challenge, and verifies its exact signed response', async () => {
    const f = await licenseFixture();
    const challenge = await f.challenge();
    f.respond(challenge);
    expect(await f.protocol.activationChallenge('request-1', 'owner-activation-secret')).toEqual(
      expect.objectContaining({ id: challenge.id }),
    );
    const issued = await f.bundle(challenge);
    f.respond(issued);
    expect(await f.protocol.complete(challenge, 5000)).toEqual(issued);
    const [activation, completion] = Schema.decodeUnknownSync(Schema.Tuple([Schema.Unknown, Schema.Unknown]))(
      await Promise.all(f.requests.map((request) => request.json())),
    );
    expect(activation).toEqual({
      requestId: 'request-1',
      activationKey: 'owner-activation-secret',
      clusterId: f.installation.clusterId,
      publicKey: f.installation.publicKey,
    });
    const body = completionBody(completion);
    expect(body.challengeId).toBe(challenge.id);
    await verifyInstallationProof(body.proof, challenge, f.installation.publicKey, 5000);
    expect(JSON.stringify(completion)).not.toContain('owner-activation-secret');
  });

  it('refreshes with the installation identity and can recover the same response after the original challenge expires', async () => {
    const f = await licenseFixture();
    const challenge = await f.challenge('refresh');
    f.respond(challenge);
    expect((await f.protocol.refreshChallenge('request-1', 'installation-1')).purpose).toBe('refresh');
    const issued = await f.bundle(challenge);
    f.respond(issued);
    expect(await f.protocol.complete(challenge, challenge.expiresAt + 1000)).toEqual(issued);
    await expect(f.protocol.complete(challenge, 5000 + STANDARD_OFFLINE_MILLISECONDS)).rejects.toThrow('exp');
    const bodies: unknown = await Promise.all(f.requests.slice(0, 1).map((request) => request.json()));
    expect(bodies).toEqual([{ requestId: 'request-1', installationId: 'installation-1' }]);
  });

  it('retains signed capacity tokens for separate admission verification without treating the license response as a grant', async () => {
    const f = await licenseFixture();
    const challenge = await f.challenge();
    const issued = await f.bundle(challenge, { allocationIds: ['allocation-1'], grantIds: ['lot-1'] }, [
      'signed-capacity-pending-admission-verification',
    ]);
    f.respond(issued);
    expect((await f.protocol.complete(challenge, 5000)).allocationTokens).toEqual(issued.allocationTokens);
  });
});

describe('the authority captured by a license client', () => {
  it('keeps the original public trust when its caller later mutates the input object', async () => {
    const f = await licenseFixture();
    const challenge = await f.challenge();
    const issued = await f.bundle(challenge);
    f.respond(issued);
    Object.defineProperty(f.trust, 'issuer', { value: 'https://changed.auto.test' });
    Object.defineProperty(f.trust, 'ring', { value: 'production' });
    Object.defineProperty(f.trust.keys, 'length', { value: 0 });
    expect((await f.protocol.complete(challenge, 5000)).license.issuer).toBe('https://accounts.auto.test');
    expect(f.requests.map((request) => new URL(request.url).origin)).toEqual(['https://accounts.auto.test']);
  });

  it('refuses an altered token before returning a license', async () => {
    const f = await licenseFixture();
    const challenge = await f.challenge();
    const issued = await f.bundle(challenge);
    f.respond({ ...issued, entitlementToken: `${issued.entitlementToken}x` });
    await expect(f.protocol.complete(challenge, 5000)).rejects.toThrow(/signature|JWS/u);
  });
});
