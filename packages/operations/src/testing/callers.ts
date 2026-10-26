import { allPermissions, type CallerIdentity, type Context } from '../index.ts';

export const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const acmeAlphaReader: CallerIdentity = {
  id: 'acme-alpha-reader',
  name: 'acme-alpha-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: ['alpha'],
};

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', name: 'globex-admin', org: 'globex' };

export const testedContext: Context = { at: '2026-10-05T09:00:00.000Z', by: 'tester' };
