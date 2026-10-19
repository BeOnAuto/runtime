import type { Outcome, Succeeded } from '@on.auto/operations';
import type { ConsentClientOptions } from '@on.auto/tool-servers';
import { consentedAt, registeredAt, type ClientRegistration, type FakeMcpServer } from '@on.auto/tool-servers/testing';

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
  readonly protectedResourceAt?: string;
  readonly authorizationServerAt?: string;
  readonly openIdConfigurationAt?: string;
  readonly endpointsAt?: EndpointsAt;
}

export interface TheVendor {
  readonly fake: FakeMcpServer;
  readonly vendor: Vendor;
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

function answeredAsTheVendor(fake: FakeMcpServer, vendor: Vendor): ConsentClientOptions['fetch'] {
  const pathsAtTheFake = pathsAtTheFakeOf(vendor);
  return (...[address, init]: readonly [unknown, unknown?]) => {
    const asked = new URL(String(address));
    if (asked.origin === fake.origin) {
      return globalThis.fetch(asked, Object.assign({}, init));
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

export function harnessAtTheVendor(
  fake: FakeMcpServer,
  vendor: Vendor,
  { providers, registeredIssuer }: AtTheVendor,
): Harness {
  return consentHarnessAt(fake, {
    providers,
    consenting: {
      fetch: answeredAsTheVendor(fake, vendor),
      registeredClients: registeredIssuer === undefined ? [] : [registeredAt(registeredIssuer)],
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
