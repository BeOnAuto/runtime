import { required } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { readProviders, type Placeholder, type ProviderEntry, providersShippedRoots } from '@on.auto/providers';
import { clockAt, manualTimer } from '@on.auto/tool-servers/testing';
import { Function, Option, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { reconnectionStartedAt } from '../testing/consents.ts';
import { consentServedAs, servedAs, sourceOver } from '../testing/served-connections.ts';
import { vendorsOfTheShippedWays } from '../testing/shipped-vendors.ts';
import {
  consentedAtTheVendor,
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

function examplesOf({ placeholders = {} }: ProviderEntry): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(placeholders).map(([name, { example, choices = [] }]: readonly [string, Placeholder]) => [
      name,
      example ?? choices[0]?.value ?? '',
    ]),
  );
}

interface WayOfConsent {
  readonly name: string;
  readonly placeholders: Readonly<Record<string, string>>;
  readonly issuer: string;
  readonly scope: string | undefined;
  readonly clients: readonly string[];
  readonly vendor: VendorOfTheWay | undefined;
}

const waysOfConsent: readonly WayOfConsent[] = shipped.providers.flatMap(({ entry }) =>
  entry.credentials.flatMap(({ kind, issuer, scope, clients = ['registered'] }) =>
    kind === 'authorization' && issuer !== undefined
      ? [
          {
            name: entry.name,
            placeholders: examplesOf(entry),
            issuer,
            scope,
            clients,
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

async function consentOf({ name, placeholders, issuer, scope, vendor }: WayOfConsent, registered: boolean) {
  const theVendor = required(vendor);
  const fake = await servedAsTheVendor(theVendor);
  closing.push(fake.close);
  const h = harnessAtTheVendor(fake, theVendor, {
    providers: shipped,
    registeredIssuer: registered ? issuer : undefined,
  });
  const { asked, finished } = await consentedAtTheVendor(
    h,
    { provider: name, placeholders, scope },
    { fake, vendor: theVendor },
  );
  const facts = await h.facts();
  const { status, granted_scope: grantedScope, credential } = connectedOf(finished).output;
  return {
    provider: name,
    authorization_endpoint: `${asked.origin}${asked.pathname}`.replace(fake.origin, '<the fake>'),
    scope: asked.searchParams.get('scope'),
    resource: asked.searchParams.get('resource'),
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
    code_challenge_method: 'S256',
    parameters,
    client_sources: [source],
    connected: { status: 'connected', granted_scope: metadata.grantedScope ?? asked, client_source: source },
  };
}

function sourceTakenBesideARegisteredClient({ clients }: WayOfConsent): string {
  return clients.includes('registered') ? 'registered' : 'dynamic';
}

const providersTakingConsent = [
  'adobe-analytics',
  'adobe-analytics-mcp',
  'amazon-ads',
  'amazon-ads-mcp',
  'atlassian',
  'buffer',
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
  'youtube',
  'youtube-analytics',
  'youtube-management',
  'zoom',
];

describe('every way of consent of a shipped provider, against the fake authorization server at its vendor’s addresses', () => {
  it('starts at the issuer its server names, with its scope, what the metadata adds and the parameters it sets, by the client whoever runs Auto registered there, or the one it registers itself where the way takes none registered, and finishes connected with that scope', async () => {
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
      'buffer',
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
  const { finished } = await consentedAtTheVendor(
    h,
    { provider: way.name, placeholders: way.placeholders, scope: way.scope },
    { fake, vendor },
  );
  const { id } = connectedOf(finished).output;
  const source = sourceOver(h, { providers: shipped });
  return { fake, h, id, source, consent: await consentServedAs(source, id) };
}

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
