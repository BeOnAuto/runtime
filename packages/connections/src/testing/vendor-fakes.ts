import type { ConsentClientOptions } from '@on.auto/tool-servers';
import { registeredAt, type ClientRegistration, type FakeMcpServer } from '@on.auto/tool-servers/testing';

import { added } from './additions.ts';
import { consentFake, consentHarnessAt, startedAt } from './consents.ts';
import type { Harness, HarnessOptions } from './harness.ts';

export interface Vendor {
  readonly metadata: Partial<ClientRegistration>;
  readonly protectedResourceAt: string;
  readonly authorizationServerAt: string;
}

export interface AtTheVendor {
  readonly providers: NonNullable<HarnessOptions['providers']>;
  readonly registeredIssuer: string | undefined;
}

const unpublished = 404;

function answeredAsTheVendor(fake: FakeMcpServer, vendor: Vendor): ConsentClientOptions['fetch'] {
  const pathsAtTheFake: ReadonlyMap<string, string> = new Map([
    [vendor.protectedResourceAt, '/.well-known/oauth-protected-resource/mcp'],
    [vendor.authorizationServerAt, '/.well-known/oauth-authorization-server'],
  ]);
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

export async function startedAtTheVendor(h: Harness, provider: string): Promise<URL> {
  const { url } = await startedAt(h, await added(h, { provider }));
  return new URL(url);
}
