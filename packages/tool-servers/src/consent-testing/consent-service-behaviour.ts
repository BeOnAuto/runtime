import { describe, expect, it } from 'vitest';

import {
  connected,
  fromTheRuntime,
  loopback,
  pairOf,
  posted,
  redeemed,
  redeemOf,
  sent,
  started,
  takeOf,
  tenMinutesMs,
  type Made,
  type VendorAnswer,
} from './consent-service-calls.ts';

export {
  controlledVendor,
  type ConsentServiceUnderTest,
  type ControlledVendor,
  type VendorAnswer,
  type VendorCall,
  type VendorFetch,
} from './consent-service-calls.ts';

/**
 * THE CONTRACT OF AUTO'S CONSENT SERVICE, as the runtime and Studio call it: these cases run on the fake the runtime's
 * tests use (`fakeConsentServiceAnswers`) and on the service itself, so the fake answers what the service answers.
 */
const aString: unknown = expect.any(String);

function clientsListed(made: Made): void {
  it('lists a client at its issuer', async () => {
    const service = await made();
    const listed = await sent(service, '/clients');
    expect(listed.status).toBe(200);
    const itsClient: unknown = expect.objectContaining({ issuer: service.issuer, client_id: aString });
    expect(listed.body.clients).toContainEqual(itsClient);
  });
}

function startsRefused(made: Made): void {
  it.each([
    ['an issuer it has no client at', { issuer: 'https://no-client.example.com' }],
    ['a hosted return to another Studio', { return: { kind: 'hosted', base: 'https://studio.elsewhere.example/' } }],
    ['a loopback return off the loopback', { return: { kind: 'loopback', base: 'http://10.0.0.7:5555/studio/' } }],
    ['a challenge that is no S256 challenge', { challenge: 'short' }],
    ['a parameter the service sets itself', { parameters: { redirect_uri: 'https://elsewhere.example/' } }],
  ])('refuses a start with %s, 400', async (_: string, asked: Readonly<Record<string, unknown>>) => {
    const service = await made();
    const pair = pairOf();
    const answered = await fromTheRuntime(service, '/consents', {
      issuer: service.issuer,
      return: loopback,
      challenge: pair.challenge,
      challenge_method: 'S256',
      ...asked,
    });
    expect(answered.status).toBe(400);
  });
}

function consentsStarted(made: Made): void {
  it('starts a consent for ten minutes, the person sent to the vendor with a challenge of its own and back to its return address', async () => {
    const service = await made();
    const { answered, pair, start } = await started(service, { parameters: { prompt: 'consent' } });
    const query = new URL(start.url).searchParams;
    const challenge = query.get('code_challenge');
    expect([answered.status, Date.parse(start.expires_at)]).toEqual([201, service.now() + tenMinutesMs]);
    expect(
      ['state', 'redirect_uri', 'code_challenge_method', 'prompt', 'scope'].map((name) => query.get(name)),
    ).toEqual([start.state, service.returnAddress, 'S256', 'consent', service.scope]);
    expect([challenge?.length, challenge === pair.challenge]).toEqual([43, false]);
  });

  it('starts a hosted consent that sends the person back to its Studio', async () => {
    const service = await made();
    const { answered } = await started(service, { return: { kind: 'hosted', base: service.studioBase } });
    expect(answered.status).toBe(201);
  });
}

function redeemsSignedIn(made: Made): void {
  it('asks a person to sign in first to redeem a code, 401 with a Bearer challenge, and exchanges nothing', async () => {
    const service = await made();
    const { start } = await started(service);
    const code = await service.consentAt(start.url);
    const answered = await posted(service, `/consents/${start.state}/redeem`, { code }, {});
    expect([answered.status, answered.authenticate, service.vendor.called('code')]).toEqual([401, 'Bearer', 0]);
  });

  it('exchanges a code at the vendor once, and refuses a second redeem of the consent, 409', async () => {
    const service = await made();
    const { start } = await started(service);
    const code = await service.consentAt(start.url);
    const first = await redeemOf(service, start.state, code);
    const second = await redeemOf(service, start.state, code);
    expect([first.status, typeof first.body.handle, second.status]).toEqual([200, 'string', 409]);
    expect(service.vendor.called('code')).toBe(1);
  });
}

function redeemsTheVendorRefused(made: Made): void {
  it.each([
    ['refused the code', { status: 400, body: { error: 'invalid_grant' } }, 400, 'code_refused'],
    ['refused Auto’s client', { status: 401, body: { error: 'invalid_client' } }, 502, undefined],
    ['failed', { status: 500, body: {} }, 502, undefined],
  ])(
    'answers a redeem the vendor %s as %i',
    async (_: string, vendorAnswer: VendorAnswer, status: number, refused: string | undefined) => {
      const service = await made();
      const { start } = await started(service);
      const code = await service.consentAt(start.url);
      service.vendor.answerNext('code', vendorAnswer);
      const answered = await redeemOf(service, start.state, code);
      expect([answered.status, answered.body.refused]).toEqual([status, refused]);
    },
  );
}

function handedOffOnce(made: Made): void {
  it('hands the tokens off once, to the verifier of the challenge alone, and keeps the handoff from a wrong one', async () => {
    const service = await made();
    const { pair, handle } = await redeemed(service);
    const wrong = await takeOf(service, handle, pairOf().verifier);
    const taken = await takeOf(service, handle, pair.verifier);
    const again = await takeOf(service, handle, pair.verifier);
    expect([wrong.status, wrong.body.refused, again.status]).toEqual([403, 'wrong_verifier', 404]);
    expect(taken).toMatchObject({
      status: 200,
      body: { connection_key: aString, client_id: aString },
    });
  });

  it('lets a consent and a handoff lapse after ten minutes', async () => {
    const service = await made();
    const lapsed = await started(service);
    const { pair, handle } = await redeemed(service);
    const code = await service.consentAt(lapsed.start.url);
    service.advance(tenMinutesMs);
    expect([
      (await redeemOf(service, lapsed.start.state, code)).status,
      (await takeOf(service, handle, pair.verifier)).status,
    ]).toEqual([404, 404]);
  });
}

function keysKept(made: Made): void {
  it('refreshes and revokes for a connection key it handed off alone, 403 unknown_key otherwise', async () => {
    const service = await made();
    const key = await connected(service);
    const unknown = { ...key, connection_key: pairOf().verifier };
    const answers = [
      await fromTheRuntime(service, '/tokens/refresh', unknown),
      await fromTheRuntime(service, '/tokens/revoke', unknown),
    ];
    const refreshed = await fromTheRuntime(service, '/tokens/refresh', key);
    expect(answers.map(({ status, body }) => [status, body.refused])).toEqual([
      [403, 'unknown_key'],
      [403, 'unknown_key'],
    ]);
    expect(refreshed).toMatchObject({ status: 200, body: { tokens: { access_token: aString } } });
  });
}

function vendorRefusals(made: Made): void {
  it('answers a refresh the vendor refused as the consent’s end with 400 invalid_grant', async () => {
    const service = await made();
    const key = await connected(service);
    service.vendor.answerNext('refresh', { status: 400, body: { error: 'invalid_grant' } });
    const answered = await fromTheRuntime(service, '/tokens/refresh', key);
    expect([answered.status, answered.body.refused]).toEqual([400, 'invalid_grant']);
  });

  it('revokes once the vendor does, 204, and answers 502 not_revoked with the vendor’s status where it refuses', async () => {
    const service = await made();
    const key = await connected(service);
    service.vendor.answerNext('revoke', { status: 503, body: {} });
    const refused = await fromTheRuntime(service, '/tokens/revoke', key);
    const revoked = await fromTheRuntime(service, '/tokens/revoke', key);
    expect([refused.status, refused.body.refused, refused.body.vendor_status, revoked.status]).toEqual([
      502,
      'not_revoked',
      503,
      204,
    ]);
  });
}

export function consentServiceBehaviour(name: string, made: Made): void {
  describe(`the consent service, as the runtime and Studio call it: ${name}`, () => {
    clientsListed(made);
    startsRefused(made);
    consentsStarted(made);
    redeemsSignedIn(made);
    redeemsTheVendorRefused(made);
    handedOffOnce(made);
    keysKept(made);
    vendorRefusals(made);
  });
}
