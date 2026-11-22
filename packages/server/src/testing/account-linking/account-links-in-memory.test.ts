import { describe, expect, it } from 'vitest';

import { accountLinksBehaviour } from './account-links-behaviour.ts';
import { accountLinksInMemory, namesFromTheServiceOf } from './account-links-in-memory.ts';

accountLinksBehaviour({ name: 'in memory', linksOf: () => Promise.resolve(accountLinksInMemory()) });

describe('the names a service gives, as a test gives them', () => {
  it('name the service and the members given, and nothing else', async () => {
    const names = namesFromTheServiceOf({
      services: { 'T-northwind': { service: 'A chat', app: 'Auto' } },
      members: { 'U-dana': { memberName: 'Dana', accountName: 'Northwind' } },
    });

    expect([
      await names.ofTheService('T-northwind'),
      await names.ofTheService('T-elsewhere'),
      await names.ofTheMember({ account: 'T-northwind', member: 'U-dana' }),
      await names.ofTheMember({ account: 'T-northwind', member: 'U-omar' }),
    ]).toEqual([
      { service: 'A chat', app: 'Auto' },
      undefined,
      { memberName: 'Dana', accountName: 'Northwind' },
      undefined,
    ]);
  });
});
