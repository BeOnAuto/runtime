import {
  asAManagedServiceAccount,
  asTheCompanysServiceAccount,
  providerListOf,
  providerOf,
} from '@on.auto/providers/testing';
import { Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { added } from '../testing/additions.ts';
import { addedThe, exchanging, onTheLink } from '../testing/exchange-harness.ts';
import {
  emailOf,
  exchangeProviders,
  exchangeProvidersWith,
  mailExchanging,
  managedWay,
  ownValues,
  ownWay,
  tokenEndpoint,
} from '../testing/exchanges.ts';
import type { Harness } from '../testing/harness.ts';
import { preparedOf, servedAs, sourceOver } from '../testing/served-connections.ts';

async function connectedAsManaged(h: Harness) {
  const link = await addedThe(h, managedWay);
  await onTheLink(h, 'create_service_account', link);
  await onTheLink(h, 'approve', link);
  return link;
}

describe('a connection that acts as a service account Auto created, served to its playbooks', () => {
  it('exchanges a token built from the current entry’s way with the account’s values placed, and serves only the tools the entry marks reads', async () => {
    const { h } = exchanging();
    const link = await connectedAsManaged(h);

    const { settings } = await preparedOf(sourceOver(h, { providers: exchangeProviders }), link.id);

    expect(settings).toMatchObject({
      allowed: ['mailboxes_list', 'messages_list'],
      auth: {
        grant: 'token_exchange',
        token_endpoint: tokenEndpoint,
        audience: '//identity.mail.example.com/projects/566645377701/pools/auto/providers/auto',
        subject_token: {
          type: 'urn:ietf:params:oauth:token-type:jwt',
          audience: 'https://identity.mail.example.com/projects/566645377701/pools/auto/providers/auto',
        },
        impersonation: { url: `https://credentials.mail.example.com/v1/accounts/${emailOf(link.id)}:token` },
        scope: 'mail.read',
        credential: { kind: 'subject_token' },
      },
    });
  });
});

describe('a connection of the company’s own service account, served to its playbooks', () => {
  it('exchanges a token with the values the person gave, and serves every tool', async () => {
    const { h } = exchanging();
    const link = await addedThe(h, ownWay, { placeholders: ownValues });
    await onTheLink(h, 'approve', link);

    const { settings } = await preparedOf(sourceOver(h, { providers: exchangeProviders }), link.id);

    expect(settings.auth).toMatchObject({
      audience: '//identity.mail.example.com/projects/123456789012/pools/auto/providers/auto',
    });
    expect(settings.allowed).toBeNull();
  });

  it('exchanges no scope where its way asks none', async () => {
    const unscoped = Struct.omit(asTheCompanysServiceAccount, ['scope', 'says']);
    const { h } = exchanging({ providers: exchangeProvidersWith(unscoped, asAManagedServiceAccount) });
    const link = await addedThe(h, ownWay, { placeholders: ownValues });
    await onTheLink(h, 'approve', link);

    const { settings } = await preparedOf(sourceOver(h, { providers: exchangeProvidersWith(unscoped) }), link.id);

    expect(settings.auth).toMatchObject({ grant: 'token_exchange', scope: null });
  });
});

describe('a connection that exchanges a token, not served', () => {
  it.each([
    ['its way is no longer offered', exchangeProvidersWith(asTheCompanysServiceAccount)],
    [
      'its values no longer fit its way',
      exchangeProvidersWith(asTheCompanysServiceAccount, {
        ...asAManagedServiceAccount,
        placeholders: {
          ...asAManagedServiceAccount.placeholders,
          project: { ...asAManagedServiceAccount.placeholders.project, pattern: '^[a-z]{6,20}$', example: 'acmemail' },
        },
      }),
    ],
    [
      'the entry marks no tool reads for a way that only reads',
      providerListOf(providerOf(Struct.omit(mailExchanging, ['marks']))),
    ],
  ] as const)('is not served where %s', async (_named, providers) => {
    const { h } = exchanging();
    const link = await connectedAsManaged(h);

    expect((await servedAs(sourceOver(h, { providers }), link.id)).state).toMatchObject({ status: 'connected' });
    await expect(preparedOf(sourceOver(h, { providers }), link.id)).rejects.toMatchObject({
      because: 'connection_not_allowed',
    });
  });
});

describe('a connection that only reads, allowed some tools of its own', () => {
  it('serves the tools both the connection allows and the entry marks reads', async () => {
    const { h } = exchanging();
    const link = await added(h, {
      provider: 'mail',
      credential: managedWay,
      entry: { allowed: ['mailboxes_list', 'messages_send'] },
    });
    await onTheLink(h, 'create_service_account', link);
    await onTheLink(h, 'approve', link);

    const { settings } = await preparedOf(sourceOver(h, { providers: exchangeProviders }), link.id);

    expect(settings.allowed).toEqual(['mailboxes_list']);
  });
});
