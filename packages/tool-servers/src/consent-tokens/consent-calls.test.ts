import { createHash } from 'node:crypto';

import { keptTextOf } from '@on.auto/operations/testing';
import { Effect, Option } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConsentClient, ConsentServed } from '../consent/consent-client.ts';
import type { ConsentAuth } from '../settings/server-settings.ts';
import { fakeConnections } from '../testing/fake-connections.ts';
import {
  connectedByConsent,
  consentClientAt,
  consentRegistration,
  everyHost,
  finishAskedOf,
  memoryTokens,
  patientTiming,
  reportingAccess,
  returnAddress,
  rowOf,
  serveFakeApi,
  servedForConsent,
  servedOf,
  type FakeApiServer,
  type FakeMcpServer,
  clockAt,
} from '../testing/index.ts';
import type { KeptTokens } from './kept-tokens.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function authOf(served: ConsentServed): ConsentAuth {
  return {
    issuer: served.way.issuer,
    client_id: served.client.client_id,
    scope: served.way.scope ?? null,
    credential: { kind: 'consent', ...served },
  };
}

function accessTo(entry: Readonly<Record<string, unknown>>, served: ConsentServed, consent: ConsentClient) {
  const connections = fakeConnections();
  connections.connect('acme', { id: 'files-id', name: 'files', entry, auth: authOf(served) });
  const reporting = reportingAccess({}, { connections, consent, timing: patientTiming, now: () => 0 });
  closing.push(reporting.access.close);
  return reporting;
}

function calledWith(
  access: ReturnType<typeof accessTo>['access'],
  tool: string,
  input: Readonly<Record<string, unknown>>,
) {
  return Effect.runPromise(
    access.callOnce({ org: 'acme', playbook: 'alpha', reference: { server: 'files', tool }, input, meta: {} }),
  );
}

const alpha = { org: 'acme', playbook: 'alpha' };

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function echoingTokens(tokens: KeptTokens) {
  return (...[address, init]: readonly [unknown, unknown?]): Promise<Response> =>
    String(address).endsWith('/token')
      ? Promise.resolve(
          Response.json(
            {
              error: 'invalid_request',
              error_description: `Refused ${String(tokens.refresh_token)} for ${tokens.access_token}`,
            },
            { status: 400 },
          ),
        )
      : globalThis.fetch(String(address), Object.assign({}, init));
}

async function servedMcp(): Promise<FakeMcpServer> {
  const fake = await servedForConsent();
  closing.push(fake.close);
  return fake;
}

describe('a call through an MCP connection connected by consent', () => {
  it('sends its access token, and holds neither token in what it records or the lines its server reports', async () => {
    const fake = await servedMcp();
    const connected = await connectedByConsent(fake);
    const tokens = connected.kept;
    const clock = clockAt(0);
    const served = servedOf(connected, rowOf(connected, clock.now));
    const consent = consentClientAt(fake, { fetch: echoingTokens(tokens) });
    const { access, content, messages } = accessTo({ url: fake.url }, served, consent);
    const said = `${tokens.access_token} and ${String(tokens.refresh_token)}`;
    const keptAnswer = JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ said: '[redacted] and [redacted]' }) }],
    });

    const echoed = await calledWith(access, 'echo', { said });
    fake.revokeTokens();
    const refused = await calledWith(access, 'echo', { said: 'again' });

    expect(fake.seen().some(({ authorization }) => authorization === `Bearer ${tokens.access_token}`)).toBe(true);
    expect(echoed).toMatchObject({ outcome: 'result' });
    await expect(keptTextOf(content, alpha, digest(keptAnswer))).resolves.toBe(keptAnswer);
    expect(JSON.stringify([echoed, refused, messages()])).not.toContain(tokens.access_token);
    expect(JSON.stringify([echoed, refused, messages()])).not.toContain(String(tokens.refresh_token));
    expect(JSON.stringify(messages())).toContain('Refused [redacted] for [redacted]');
  });
});

async function servedApi(): Promise<FakeApiServer> {
  const api = await serveFakeApi({ client: consentRegistration() });
  closing.push(api.close);
  return api;
}

async function connectedToApi(api: FakeApiServer) {
  const issuer = Option.getOrThrow(Option.fromNullishOr(api.issuing)).issuer;
  const consent = consentClientAt({ origin: issuer });
  const asked = await finishAskedOf(consent, {
    server: { type: 'openapi' },
    way: { issuer, scope: 'files.read' },
    returnAddress,
    reaches: everyHost,
    state: 'state-1',
  });
  const finished = await Effect.runPromise(consent.finish(asked).pipe(Effect.provide(TestClock.layer())));
  const clock = clockAt(0);
  const row = memoryTokens(finished.tokens, { now: clock.now });
  const served: ConsentServed = {
    server: { type: 'openapi' },
    way: asked.way,
    returnAddress,
    reaches: everyHost,
    client: asked.client,
    held: Effect.runSync(Effect.orDie(row.read)),
    tokens: row,
  };
  return { consent, served, row };
}

describe('a call through an HTTP API connected by consent', () => {
  it('sends its access token as a bearer, and renews it once when the API refuses it', async () => {
    const api = await servedApi();
    const { consent, served, row } = await connectedToApi(api);
    const { access } = accessTo({ document: api.documentUrl }, served, consent);

    const first = await calledWith(access, 'search', { query: 'acme' });
    api.issuing?.revokeTokens();
    const renewed = await calledWith(access, 'search', { query: 'acme' });

    expect([first, renewed]).toMatchObject([{ outcome: 'result' }, { outcome: 'result' }]);
    expect(row.version()).toBe(2);
  });
});
