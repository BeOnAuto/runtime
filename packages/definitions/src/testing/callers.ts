import { allPermissions, recordedCallerOf, type CallerIdentity } from '@on.auto/operations';

export const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const recordedAdmin = recordedCallerOf(acmeAdmin);

export const adaOfAcme: CallerIdentity = { ...acmeAdmin, id: 'person:user_2ada', name: 'Ada Lovelace' };

export const acmeReader: CallerIdentity = {
  id: 'acme-reader',
  name: 'acme-reader',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: '*',
};

export const acmeAlphaKeeper: CallerIdentity = {
  id: 'acme-alpha-keeper',
  name: 'acme-alpha-keeper',
  org: 'acme',
  permissions: ['playbook:read', 'playbook:write'],
  playbooks: ['alpha'],
};

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', name: 'globex-admin', org: 'globex' };
