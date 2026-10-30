import type { Outcome, Succeeded } from '@on.auto/operations';
import type { Placeholder, ProviderEntry } from '@on.auto/providers';
import type { ConsentClientOptions, RegisteredClient } from '@on.auto/tool-servers';
import { consentedAt, registeredAt, type ClientRegistration, type FakeMcpServer } from '@on.auto/tool-servers/testing';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added } from './additions.ts';
import { consentFake, consentHarnessAt, finishing, startedAt } from './consents.ts';
import type { Harness, HarnessOptions } from './harness.ts';

interface EndpointsAt {
  readonly authorization: string;
  readonly token: string;
  readonly revocation?: string;
}

export interface Vendor {
  readonly metadata: Partial<ClientRegistration>;
  readonly challengedAt?: string;
  readonly protectedResourceAt?: string;
  readonly authorizationServerAt?: string;
  readonly openIdConfigurationAt?: string;
  readonly endpointsAt?: EndpointsAt;
}

export interface VendorOfTheWay extends Vendor {
  readonly resource: string | null;
  readonly asked?: string;
  readonly parameters?: Readonly<Record<string, string>>;
}

export interface TheVendor {
  readonly fake: FakeMcpServer;
  readonly vendor: Vendor;
}

function firstValueOf({ example, choices = [] }: Placeholder): readonly string[] {
  return [...(example === undefined ? [] : [example]), ...choices.map(({ value }) => value)].slice(0, 1);
}

export function examplesOf({ placeholders = {} }: ProviderEntry): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(placeholders).flatMap(([name, placeholder]: readonly [string, Placeholder]) =>
      firstValueOf(placeholder).map((value) => [name, value]),
    ),
  );
}

export interface AtTheVendor {
  readonly providers: NonNullable<HarnessOptions['providers']>;
  readonly registeredIssuer: string | undefined;
}

export interface ProviderAsked {
  readonly provider: string;
  readonly placeholders: Readonly<Record<string, string>>;
}

export interface ConsentedAtTheVendor {
  readonly asked: URL;
  readonly finished: Outcome<Succeeded>;
}

type AnsweredAt = readonly [string, string];

const unpublished = 404;

const unauthorized = 401;

function pathsAtTheFakeOf({
  protectedResourceAt,
  authorizationServerAt,
  openIdConfigurationAt,
  endpointsAt,
}: Vendor): ReadonlyMap<string, string> {
  const answered: readonly (readonly [string | undefined, string])[] = [
    [protectedResourceAt, '/.well-known/oauth-protected-resource/mcp'],
    [authorizationServerAt, '/.well-known/oauth-authorization-server'],
    [openIdConfigurationAt, '/.well-known/openid-configuration'],
    [endpointsAt?.token, '/token'],
    [endpointsAt?.revocation, '/revoke'],
  ];
  return new Map(
    answered.flatMap(([address, path]): readonly AnsweredAt[] => (address === undefined ? [] : [[address, path]])),
  );
}

function challengesOf({ challengedAt, protectedResourceAt }: Vendor): ReadonlyMap<string, string> {
  return challengedAt === undefined || protectedResourceAt === undefined
    ? new Map()
    : new Map([[challengedAt, protectedResourceAt]]);
}

function challengeNaming(resourceMetadata: string): Response {
  return new Response(null, {
    status: unauthorized,
    headers: { 'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadata}"` },
  });
}

function answeredAsTheVendor(fake: FakeMcpServer, vendor: Vendor): ConsentClientOptions['fetch'] {
  const pathsAtTheFake = pathsAtTheFakeOf(vendor);
  const challenges = challengesOf(vendor);
  return (...[address, init]: readonly [unknown, unknown?]) => {
    const asked = new URL(String(address));
    if (asked.origin === fake.origin) {
      return globalThis.fetch(asked, Object.assign({}, init));
    }
    const challenged = challenges.get(asked.href);
    if (challenged !== undefined) {
      return Promise.resolve(challengeNaming(challenged));
    }
    const path = pathsAtTheFake.get(asked.href);
    return path === undefined
      ? Promise.resolve(new Response(null, { status: unpublished }))
      : globalThis.fetch(new URL(path, fake.origin), Object.assign({}, init));
  };
}

export function servedAsTheVendor(vendor: Vendor): Promise<FakeMcpServer> {
  return consentFake(vendor.metadata);
}

function registeredAtTheVendor(issuer: string, { metadata }: Vendor): RegisteredClient {
  return metadata.takesPublicClientsAlone === true
    ? registeredAt(issuer, { credential: { kind: 'public' } })
    : registeredAt(issuer);
}

const urlOrigin = /https?:\/\/[^/\s"'{}:]+/gu;

function vendorDomainsOf(host: string): readonly string[] {
  const domain = host.split('.').slice(-2).join('.');
  return [domain, `*.${domain}`];
}

function hostsAtTheVendor(fakeOrigin: string, written: string): string[] {
  const named = [...written.matchAll(urlOrigin)].flat().map((each) => new URL(each).hostname);
  return [...new Set([new URL(fakeOrigin).hostname, ...named.flatMap((host) => vendorDomainsOf(host))])];
}

export function harnessAtTheVendor(
  fake: FakeMcpServer,
  vendor: Vendor,
  { providers, registeredIssuer }: AtTheVendor,
): Harness {
  return consentHarnessAt(fake, {
    providers,
    policy: connectionPolicyOf({ allowed_hosts: hostsAtTheVendor(fake.origin, JSON.stringify([vendor, providers])) }),
    consenting: {
      fetch: answeredAsTheVendor(fake, vendor),
      registeredClients: registeredIssuer === undefined ? [] : [registeredAtTheVendor(registeredIssuer, vendor)],
    },
  });
}

function authorizedAtTheFake(asked: Readonly<URL>, { fake, vendor }: TheVendor): string {
  return `${asked.origin}${asked.pathname}` === vendor.endpointsAt?.authorization
    ? `${fake.origin}/authorize${asked.search}`
    : asked.href;
}

export async function consentedAtTheVendor(
  h: Harness,
  { provider, placeholders }: ProviderAsked,
  theVendor: TheVendor,
): Promise<ConsentedAtTheVendor> {
  const link = await added(h, { provider, placeholders, credential: { kind: 'authorization' } });
  const asked = new URL((await startedAt(h, link)).url);
  const finished = await finishing(h, link, await consentedAt(authorizedAtTheFake(asked, theVendor)));
  return { asked, finished };
}
