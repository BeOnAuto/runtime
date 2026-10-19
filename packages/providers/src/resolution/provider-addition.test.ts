import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider, type GivenToProvider, type ProviderEntry } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import {
  adverts,
  audiences,
  campaigns,
  drive,
  ledgers,
  metrics,
  regions,
  tracker,
} from '../testing/fixture-providers.ts';

function resolved(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(additionOfProvider(provider, given));
}

function refused(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(Result.flip(additionOfProvider(provider, given)));
}

const permissiveSite = decodedEntry({
  ...tracker,
  placeholders: { site: { description: 'The site', pattern: '^.{1,64}$', example: 'acme' } },
});

describe('the addition a provider makes', () => {
  it('is its server with the values given in place, its first way, its name, and the values to record', () => {
    expect(resolved(tracker, { placeholders: { site: 'acme' } })).toEqual({
      name: 'tracker',
      type: 'mcp',
      entry: { url: 'https://acme.tracker.example.com/mcp' },
      credential: { kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer' },
      provider: 'tracker',
      placeholders: { site: 'acme' },
    });
  });

  it('takes the name, the way and what is per connection from the caller', () => {
    expect(
      resolved(tracker, {
        name: 'acme-tracker',
        kind: 'none',
        placeholders: { site: 'acme' },
        playbooks: ['sales'],
        allowed: ['search'],
        record_content: false,
      }),
    ).toMatchObject({
      name: 'acme-tracker',
      entry: {
        url: 'https://acme.tracker.example.com/mcp',
        playbooks: ['sales'],
        allowed: ['search'],
        record_content: false,
      },
      credential: { kind: 'none' },
    });
  });

  it('takes the first way the caller can be given where it names no kind, and the first where it can be given none', () => {
    const givenNoConsent = { canBeGiven: ({ kind }: { readonly kind: string }) => kind !== 'authorization' };

    expect([
      resolved(adverts, { placeholders: { tenant: 'acme' }, ...givenNoConsent }).credential.kind,
      resolved(drive, givenNoConsent).credential.kind,
      resolved(adverts, { placeholders: { tenant: 'acme' } }).credential.kind,
    ]).toEqual(['secret', 'authorization', 'authorization']);
  });
});

describe('the addition a provider of client credentials makes', () => {
  it('keeps {client_id} for the serving to place, and leaves out a header whose optional placeholder is not given', () => {
    expect(resolved(ledgers, { placeholders: { tenant: 'acme' } })).toEqual({
      name: 'ledgers',
      type: 'openapi',
      entry: {
        document: 'https://ledgers.example.com/openapi.json',
        base_url: 'https://api.ledgers.example.com/acme/v2',
        headers: { 'X-Client': '{client_id}', 'X-Format': 'json' },
        request_id: 'X-Request-Id',
      },
      credential: {
        kind: 'client_credentials',
        issuer: 'https://auth.ledgers.example.com/acme',
        scope: 'journal.read journal.write',
      },
      provider: 'ledgers',
      placeholders: { tenant: 'acme' },
    });
    expect(resolved(ledgers, { placeholders: { tenant: 'acme', manager: '1234567890' } }).entry.headers).toEqual({
      'X-Client': '{client_id}',
      'X-Manager': '1234567890',
      'X-Format': 'json',
    });
  });
});

describe('the addition a provider of consent makes', () => {
  it('keeps {client_id} for the serving to place, as the connection records no client before its consent finishes', () => {
    expect(resolved(audiences, {})).toMatchObject({
      entry: { headers: { 'X-Client': '{client_id}' } },
      credential: { kind: 'authorization', issuer: 'https://accounts.audiences.example.com', scope: 'audiences.read' },
    });
    expect(resolved(audiences, {}).credential).not.toHaveProperty('client_id');
  });
});

describe('the addition a provider without placeholders makes', () => {
  it('keeps the reference to a value whoever runs the runtime sets, as the entry writes it', () => {
    expect(resolved(metrics, {}).entry).toEqual({
      url: 'https://mcp.metrics.example.com/mcp',
      headers: { 'X-Developer-Token': '${METRICS_DEVELOPER_TOKEN}' },
    });
  });
});

describe('the addition a provider of choices makes', () => {
  it('places what the choice given sets, as it is written, and a value in a query parameter', () => {
    expect(resolved(regions, { placeholders: { region: 'eu', account: 'acme1' } }).entry).toEqual({
      document: 'https://regions.example.com/openapi.json',
      base_url: 'https://api-eu.regions.example.com/v1',
      query_params: { account: 'acme1' },
    });
  });
});

describe('the placeholders a caller gives a provider', () => {
  it('are refused at each one unknown, missing, or holding no value its pattern or its choices take', () => {
    expect(refused(regions, { placeholders: { region: 'apac', site: 'acme' } })).toEqual([
      {
        pointer: '/placeholders/site',
        detail: 'The provider regions has no placeholder site; it takes region and account',
      },
      { pointer: '/placeholders/region', detail: 'Expected one of na or eu' },
      { pointer: '/placeholders/account', detail: 'Expected account: The id of your account' },
    ]);
    expect(refused(regions, { placeholders: { region: 'na', account: 'acme-1' } })).toEqual([
      { pointer: '/placeholders/account', detail: 'Expected a value that matches ^[A-Za-z0-9]{1,32}$, such as acme1' },
    ]);
  });

  it('are refused, with the way, for a provider that takes none of them or no such kind of credential', () => {
    expect(
      refused(decodedEntry({ ...tracker, url: 'https://tracker.example.com/mcp', placeholders: {} }), {
        placeholders: { site: 'acme' },
        kind: 'client_credentials',
      }),
    ).toEqual([
      { pointer: '/placeholders/site', detail: 'The provider tracker has no placeholder site; it takes none' },
      {
        pointer: '/credential/kind',
        detail: 'The provider tracker takes no client_credentials credential; it takes secret or none',
      },
    ]);
    expect(refused(tracker, { placeholders: { site: 'acme' }, kind: 'reference' })).toEqual([
      {
        pointer: '/credential/kind',
        detail: 'The provider tracker takes no reference credential; it takes secret or none',
      },
    ]);
  });
});

describe('the values a caller gives a provider', () => {
  it('are refused for a value that looks like a credential or holds a $, with which a reference begins', () => {
    expect([
      refused(ledgers, { placeholders: { tenant: 'sk-live-0123456789abcdefghij' } }),
      refused(ledgers, { placeholders: { tenant: '${LEDGERS_TENANT}' } }),
    ]).toEqual([
      [
        {
          pointer: '/placeholders/tenant',
          detail:
            'Looks like a credential, which a placeholder never holds: the person gives the credential on the page the link opens',
        },
      ],
      [
        {
          pointer: '/placeholders/tenant',
          detail:
            'Holds a $, which a placeholder never holds, since a reference to an environment variable begins with it',
        },
      ],
    ]);
  });

  it('are refused for a $ before their pattern or their choices are asked, whatever those take', () => {
    const heldDollar =
      'Holds a $, which a placeholder never holds, since a reference to an environment variable begins with it';

    expect([
      refused(tracker, { placeholders: { site: '${TRACKER_SITE}' } }),
      refused(regions, { placeholders: { region: '${REGION}', account: 'acme1' } }),
    ]).toEqual([
      [{ pointer: '/placeholders/site', detail: heldDollar }],
      [{ pointer: '/placeholders/region', detail: heldDollar }],
    ]);
  });
});

describe('the place of a value a caller gives', () => {
  it('holds letters, digits and hyphens alone in a host, and no /, ? or # elsewhere', () => {
    expect([
      refused(permissiveSite, { placeholders: { site: 'evil.example.org/x' } }),
      refused(ledgers, { placeholders: { tenant: 'acme/../admin' } }),
      refused(ledgers, { placeholders: { tenant: 'acme?admin=1' } }),
    ]).toEqual([
      [
        {
          pointer: '/placeholders/site',
          detail: 'Expected letters, digits and hyphens alone, since the value names a host',
        },
      ],
      [{ pointer: '/placeholders/tenant', detail: 'Expected no /, ? or #, which would move the address' }],
      [{ pointer: '/placeholders/tenant', detail: 'Expected no /, ? or #, which would move the address' }],
    ]);
  });

  it('keeps the address as it is written, hosts compared in lowercase', () => {
    expect(refused(ledgers, { placeholders: { tenant: '..' } })).toEqual([
      {
        pointer: '/placeholders/tenant',
        detail: 'Expected a value the address keeps as it is written, which the reading of this URL changes',
      },
    ]);
    expect(resolved(permissiveSite, { placeholders: { site: 'ACME' } }).entry.url).toBe(
      'https://ACME.tracker.example.com/mcp',
    );
  });
});

const tenantIssued = decodedEntry({
  ...ledgers,
  credentials: [{ kind: 'client_credentials', issuer: 'https://{tenant}.auth.ledgers.example.com/oauth' }],
});

describe('a placeholder in the issuer of client credentials', () => {
  it('is placed in the credential, held to the rule of a host where it names one', () => {
    expect([
      resolved(tenantIssued, { placeholders: { tenant: 'acme' } }).credential,
      refused(tenantIssued, { placeholders: { tenant: 'acme.example.org' } }),
    ]).toEqual([
      { kind: 'client_credentials', issuer: 'https://acme.auth.ledgers.example.com/oauth' },
      [
        {
          pointer: '/placeholders/tenant',
          detail: 'Expected letters, digits and hyphens alone, since the value names a host',
        },
      ],
    ]);
  });
});

describe('the addition a provider of consent makes', () => {
  it('carries the way of consent, its endpoints and its issuer with each value in its place', () => {
    expect([
      resolved(drive, {}).credential,
      resolved(adverts, { placeholders: { tenant: 'acme' } }).credential,
    ]).toEqual([
      {
        kind: 'authorization',
        issuer: 'https://accounts.drive.example.com',
        scope: 'files.read files.write',
        parameters: { access_type: 'offline', prompt: 'consent' },
      },
      {
        kind: 'authorization',
        issuer: 'https://login.adverts.example.com/acme/v2.0',
        authorization_endpoint: 'https://login.adverts.example.com/acme/oauth2/v2.0/authorize',
        token_endpoint: 'https://login.adverts.example.com/acme/oauth2/v2.0/token',
        revocation_endpoint: 'https://login.adverts.example.com/acme/oauth2/v2.0/revoke',
        scope: 'adverts.manage offline_access',
        clients: ['registered', 'dynamic'],
      },
    ]);
  });
});

describe('the addition a provider of consent makes with a choice', () => {
  it('places the host the choice sets in the token endpoint, as it does in the address of the API', () => {
    const { entry, credential } = resolved(campaigns, { placeholders: { region: 'eu' } });

    expect([entry.base_url, credential]).toEqual([
      'https://api-eu.campaigns.example.com/v1',
      {
        kind: 'authorization',
        issuer: 'https://auth.campaigns.example.com',
        authorization_endpoint: 'https://auth.campaigns.example.com/authorize',
        token_endpoint: 'https://auth-eu.campaigns.example.com/oauth/token',
        revocation_endpoint: 'https://auth.campaigns.example.com/revoke',
        scope: 'campaigns.read',
      },
    ]);
  });
});
