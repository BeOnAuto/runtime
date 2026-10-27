import {
  INSTALLATION_CHALLENGE_MILLISECONDS,
  verifyInstallationProof,
  type InstallationChallenge,
} from '@on.auto/metering';
import { Schema } from 'effect';

import type { LicenseFetch, VerifiedLicenseBundle } from '../index.ts';
import type { licenseFixture } from './license-fixture.ts';

type Signing = Readonly<
  Pick<Awaited<ReturnType<typeof licenseFixture>>, 'challenge' | 'bundle' | 'timeToken' | 'installation'>
>;
const body = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
const field = Schema.decodeUnknownSync(Schema.String);

function authorityExchanges(signing: Signing, now: () => number, licenseId: () => string) {
  const challenges = new Map<string, InstallationChallenge>();
  const issued = new Map<string, Promise<VerifiedLicenseBundle>>();
  const state = { generation: 0 };
  return {
    challenge: async (value: Readonly<Record<string, unknown>>, purpose: InstallationChallenge['purpose']) => {
      const challenge = {
        ...(await signing.challenge(purpose, field(value['requestId']), licenseId())),
        generation: state.generation,
        createdAt: now(),
        expiresAt: now() + INSTALLATION_CHALLENGE_MILLISECONDS,
      };
      challenges.set(challenge.id, challenge);
      return Response.json(challenge);
    },
    complete: async (value: Readonly<Record<string, unknown>>) => {
      const challengeId = field(value['challengeId']);
      const challenge = challenges.get(challengeId);
      if (challenge === undefined) return new Response(null, { status: 404 });
      if (challenge.licenseId !== licenseId()) return new Response(null, { status: 401 });
      const original = issued.get(challengeId);
      await verifyInstallationProof(
        field(value['proof']),
        challenge,
        signing.installation.publicKey,
        original === undefined ? now() : challenge.createdAt,
      );
      if (original !== undefined) return Response.json(await original);
      if (state.generation !== challenge.generation) return new Response(null, { status: 409 });
      const issuedAt = Math.floor(now() / 1000) * 1000;
      const result = signing.bundle(challenge, { issuedAt });
      issued.set(challengeId, result);
      state.generation = challenge.generation + 1;
      return Response.json(await result);
    },
  };
}

export function licenseAuthority(signing: Signing, pass: (elapsed: number) => void) {
  const state = {
    now: 5000,
    challengeStatus: 0,
    completeStatus: 0,
    loseCompletion: false,
    completeDelay: 0,
    licenseId: 'license-1',
    activationKey: 'activation-secret',
  };
  const exchanges = authorityExchanges(
    signing,
    () => state.now,
    () => state.licenseId,
  );
  const requests: Readonly<Request>[] = [];
  const fetch: LicenseFetch = async (request) => {
    requests.push(request);
    const value = body(await request.json());
    const path = new URL(request.url).pathname;
    if (path === '/licenses/time')
      return Response.json({ timeToken: await signing.timeToken(field(value['requestId']), state.now) });
    if (path === '/licenses/complete') {
      if (state.completeStatus !== 0) return new Response(null, { status: state.completeStatus });
      state.now += state.completeDelay;
      pass(state.completeDelay);
      const response = await exchanges.complete(value);
      if (state.loseCompletion) {
        state.loseCompletion = false;
        throw new Error('private network failure');
      }
      return response;
    }
    if (state.challengeStatus !== 0) return new Response(null, { status: state.challengeStatus });
    if (path === '/licenses/activation-challenge' && value['activationKey'] !== state.activationKey)
      return new Response(null, { status: 401 });
    return exchanges.challenge(value, path === '/licenses/activation-challenge' ? 'activate' : 'refresh');
  };
  return { state, requests, fetch };
}
