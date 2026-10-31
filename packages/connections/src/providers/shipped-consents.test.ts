import { required } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { readProviders, providersShippedRoots } from '@on.auto/providers';
import { clockAt, manualTimer } from '@on.auto/tool-servers/testing';
import { Function, Option, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { reconnectionStartedAt, theOrgsOAuthClient } from '../testing/consents.ts';
import { consentServedAs, servedAs, sourceOver } from '../testing/served-connections.ts';
import { vendorsOfTheShippedWays } from '../testing/shipped-vendors.ts';
import {
  consentedAtTheVendor,
  examplesOf,
  harnessAtTheVendor,
  servedAsTheVendor,
  type VendorOfTheWay,
} from '../testing/vendor-fakes.ts';

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const shipped = Result.getOrThrow(await readProviders(providersOnDisk));

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface WayOfConsent {
  readonly name: string;
  readonly placeholders: Readonly<Record<string, string>>;
  readonly issuer: string;
  readonly scope: string | undefined;
  readonly clients: readonly string[];
  readonly oauthClient: boolean;
  readonly vendor: VendorOfTheWay | undefined;
}

const waysOfConsent: readonly WayOfConsent[] = shipped.providers.flatMap(({ entry }) =>
  entry.credentials.flatMap(({ kind, issuer, scope, clients = ['registered'], oauth_client: oauthClient }) =>
    kind === 'authorization' && issuer !== undefined
      ? [
          {
            name: entry.name,
            placeholders: examplesOf(entry),
            issuer,
            scope,
            clients,
            oauthClient: oauthClient === 'required',
            vendor: vendorsOfTheShippedWays[entry.name],
          },
        ]
      : [],
  ),
);

const startedSourceOf = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal('connection_consent_started'),
    data: Schema.Struct({ client_source: Schema.String }),
  }),
);

const connectedOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      granted_scope: Schema.NullOr(Schema.String),
      credential: Schema.Struct({ client_source: Schema.String }),
    }),
  }),
);

function parametersAsked(
  asked: Readonly<URL>,
  { parameters = {} }: VendorOfTheWay,
): Readonly<Record<string, string | null>> {
  return Object.fromEntries(Object.keys(parameters).map((name) => [name, asked.searchParams.get(name)]));
}

async function consentOf({ name, placeholders, issuer, oauthClient, vendor }: WayOfConsent, registered: boolean) {
  const theVendor = required(vendor);
  const fake = await servedAsTheVendor(theVendor);
  closing.push(fake.close);
  const h = harnessAtTheVendor(fake, theVendor, {
    providers: shipped,
    registeredIssuer: registered ? issuer : undefined,
  });
  const { asked, finished } = await consentedAtTheVendor(
    h,
    { provider: name, placeholders, ...(oauthClient ? { orgsOAuthClient: theOrgsOAuthClient } : {}) },
    { fake, vendor: theVendor },
  );
  const facts = await h.facts();
  const { status, granted_scope: grantedScope, credential } = connectedOf(finished).output;
  return {
    provider: name,
    authorization_endpoint: `${asked.origin}${asked.pathname}`.replace(fake.origin, '<the fake>'),
    scope: asked.searchParams.get('scope'),
    resource: asked.searchParams.get('resource'),
    code_challenge: asked.searchParams.has('code_challenge'),
    code_challenge_method: asked.searchParams.get('code_challenge_method'),
    parameters: parametersAsked(asked, theVendor),
    client_sources: facts.flatMap((fact) =>
      Option.toArray(Option.map(startedSourceOf(fact), ({ data }) => data.client_source)),
    ),
    connected: { status, granted_scope: grantedScope, client_source: credential.client_source },
  };
}

function consentExpectedOf({ name, scope, vendor }: WayOfConsent, source: string) {
  const { asked = scope ?? null, resource, parameters = {}, endpointsAt, metadata } = required(vendor);
  return {
    provider: name,
    authorization_endpoint: endpointsAt?.authorization ?? '<the fake>/authorize',
    scope: asked,
    resource,
    ...(metadata.takesNoChallenge === true
      ? { code_challenge: false, code_challenge_method: null }
      : { code_challenge: true, code_challenge_method: 'S256' }),
    parameters,
    client_sources: [source],
    connected: { status: 'connected', granted_scope: metadata.grantedScope ?? asked, client_source: source },
  };
}

function sourceTakenBesideARegisteredClient({ clients, oauthClient }: WayOfConsent): string {
  if (oauthClient) {
    return 'own';
  }
  return clients.includes('registered') ? 'registered' : 'dynamic';
}

const providersTakingConsent = [
  'adobe-analytics',
  'adobe-analytics-mcp',
  'amazon-ads',
  'amazon-ads-mcp',
  'atlassian',
  'campaign-manager-360',
  'display-video-360',
  'display-video-360-reports',
  'github',
  'gmail',
  'google-ads',
  'google-analytics',
  'google-analytics-admin',
  'google-docs',
  'google-drive',
  'google-search-console',
  'google-sheets',
  'google-slides',
  'hubspot',
  'linear',
  'linkedin',
  'microsoft-advertising',
  'microsoft-teams',
  'notion',
  'onedrive',
  'outlook',
  'posthog',
  'profound',
  'search-ads-360',
  'slack',
  'stripe',
  'work-iq',
  'x',
  'youtube',
  'youtube-analytics',
  'youtube-management',
  'zoom',
];

describe('every way of consent of a shipped provider, against the fake authorization server at its vendor’s addresses', () => {
  it('starts at the issuer its server names, with its scope, what the metadata adds and the parameters it sets, by the client whoever runs Auto registered there, the one it registers itself where the way takes none registered, or the org’s own where the way requires it, and finishes connected with that scope', async () => {
    const consents = await Promise.all(waysOfConsent.map((consenting) => consentOf(consenting, true)));

    expect(consents).toEqual(
      waysOfConsent.map((consenting) => consentExpectedOf(consenting, sourceTakenBesideARegisteredClient(consenting))),
    );
    expect(waysOfConsent.map(({ name }) => name)).toEqual(providersTakingConsent);
  });

  it('starts and finishes without a registered client where its client sources take one the runtime registers itself', async () => {
    const registering = waysOfConsent.filter(({ clients }) => clients.includes('dynamic'));

    const consents = await Promise.all(registering.map((consenting) => consentOf(consenting, false)));

    expect(consents).toEqual(registering.map((consenting) => consentExpectedOf(consenting, 'dynamic')));
    expect(registering.map(({ name }) => name)).toEqual([
      'adobe-analytics-mcp',
      'atlassian',
      'linear',
      'notion',
      'posthog',
      'profound',
      'stripe',
    ]);
  });
});

const sixtyDaysMs = 5_184_000_000;

const connectedAt = Date.parse('2026-10-15T14:00:00.000Z');

const consentEnded =
  'The consent of the connection linkedin was revoked or has ended, so the person who added it reconnects it';

const refusedByLinkedIn = {
  response: new Response(null, { status: 401 }),
  serverUrl: new URL('https://api.linkedin.com'),
  fetchFn: globalThis.fetch,
};

async function connectedAtLinkedIn() {
  const way = required(waysOfConsent.find(({ name }) => name === 'linkedin'));
  const vendor = required(way.vendor);
  const fake = await servedAsTheVendor(vendor);
  closing.push(fake.close);
  const h = harnessAtTheVendor(fake, vendor, { providers: shipped, registeredIssuer: way.issuer });
  const { asked, finished } = await consentedAtTheVendor(
    h,
    { provider: way.name, placeholders: way.placeholders },
    { fake, vendor },
  );
  const { id, status } = connectedOf(finished).output;
  const source = sourceOver(h, { providers: shipped });
  return { fake, h, id, asked, status, source, consent: await consentServedAs(source, id) };
}

describe('the consent of linkedin, whose web endpoint takes no PKCE and refuses a code redeemed with a verifier', () => {
  it('starts at its authorization endpoint without a challenge and finishes connected by the client registered there, without a verifier', async () => {
    const { fake, asked, status } = await connectedAtLinkedIn();

    expect(`${asked.origin}${asked.pathname}`).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect([...asked.searchParams.keys()].filter((name) => name.startsWith('code_challenge'))).toEqual([]);
    expect(status).toBe('connected');
    expect(fake.tokenRequests()).toBe(1);
  });
});

describe('the consent of linkedin, whose vendor answers an access token of sixty days with no token_type and no refresh token', () => {
  it('serves its token to its end and past it, breaks at the first refusal in words that say to reconnect it, and reconnects by signing in at LinkedIn again', async () => {
    const { fake, h, id, source, consent } = await connectedAtLinkedIn();
    const clock = clockAt(connectedAt + sixtyDaysMs + 1);
    const tokens = h.consent.tokenSource(consent, {
      name: 'linkedin',
      holder: 'connection linkedin',
      now: clock.now,
      timer: manualTimer().timer,
      hold: Function.constVoid,
    });

    const pastItsEnd = await tokens.token();
    const refused = await tokens.onUnauthorized(refusedByLinkedIn).catch((error: unknown) => error);
    const { state } = await servedAs(source, id);
    const asked = new URL((await reconnectionStartedAt(h, id)).url);

    expect(consent.held.tokens).toMatchObject({ expires_at: new Date(connectedAt + sixtyDaysMs).toISOString() });
    expect(consent.held.tokens).not.toHaveProperty('refresh_token');
    expect(consent.held.tokens.token_type).toBe('Bearer');
    expect(pastItsEnd).toBe(consent.held.tokens.access_token);
    expect(refused).toEqual(new Error(consentEnded));
    expect(state).toEqual({ status: 'unready', unready: { because: 'connection_broken', detail: consentEnded } });
    expect(fake.tokenRequests()).toBe(1);
    expect(`${asked.origin}${asked.pathname}`).toBe('https://www.linkedin.com/oauth/v2/authorization');
  });
});
