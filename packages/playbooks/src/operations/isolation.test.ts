import { describe, expect, it } from 'vitest';

import { createPlaybook, getPlaybook, listPlaybooks, retirePlaybook, updatePlaybook } from '../index.ts';
import { acmeAdmin, acmeAlphaKeeper, acmeReader, globexAdmin } from '../testing/callers.ts';
import { harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const toGlobex = toOrg('globex');

const renamed = { name: 'Renamed', description: '' };

describe('the playbooks of two orgs', () => {
  it('are apart even when they share an id', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Acme Alpha' }));
    await call(createPlaybook, toGlobex(globexAdmin, { playbook: 'alpha', name: 'Globex Alpha' }));
    await call(updatePlaybook, toAcme(acmeAdmin, { playbook: 'alpha', ...renamed }));
    await call(retirePlaybook, toGlobex(globexAdmin, { playbook: 'alpha' }));

    expect(await call(getPlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }))).toMatchObject({
      output: { name: 'Renamed', status: 'active', created_by: { id: 'acme-admin', name: 'acme-admin' } },
    });
    expect(await call(getPlaybook, toGlobex(globexAdmin, { playbook: 'alpha' }))).toMatchObject({
      output: { name: 'Globex Alpha', status: 'retired', created_by: { id: 'globex-admin', name: 'globex-admin' } },
    });
    expect(await call(listPlaybooks, toAcme(acmeAdmin))).toMatchObject({
      output: { playbooks: [{ name: 'Renamed' }] },
    });
    expect(await call(listPlaybooks, toGlobex(globexAdmin))).toMatchObject({ output: { playbooks: [] } });
  });

  it('cannot be accessed by a caller of the other org, whether they exist or not', async () => {
    const { call } = harness();
    await call(createPlaybook, toGlobex(globexAdmin, { playbook: 'gamma', name: 'Gamma' }));
    const foreign = { status: 'rejected', reason: 'forbidden', detail: 'The caller does not belong to this org' };
    const attempts = ['gamma', 'nowhere'].flatMap((playbook) => [
      call(getPlaybook, toGlobex(acmeAdmin, { playbook })),
      call(updatePlaybook, toGlobex(acmeAdmin, { playbook, ...renamed })),
      call(retirePlaybook, toGlobex(acmeAdmin, { playbook })),
    ]);

    expect(await Promise.all(attempts)).toEqual([foreign, foreign, foreign, foreign, foreign, foreign]);
    expect(await call(createPlaybook, toGlobex(acmeAdmin, { playbook: 'delta', name: 'Delta' }))).toEqual(foreign);
    expect(await call(listPlaybooks, toGlobex(acmeAdmin))).toEqual(foreign);
    expect(await call(getPlaybook, toGlobex(globexAdmin, { playbook: 'gamma' }))).toMatchObject({
      output: { name: 'Gamma', status: 'active' },
    });
  });
});

describe('a caller limited to some playbooks', () => {
  it('is denied every other playbook, whether it exists or not, and sees only its own listed', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    const accessDenied = { status: 'rejected', reason: 'forbidden', detail: 'The caller may not access this playbook' };
    const attempts = ['beta', 'nowhere'].flatMap((playbook) => [
      call(getPlaybook, toAcme(acmeAlphaKeeper, { playbook })),
      call(updatePlaybook, toAcme(acmeAlphaKeeper, { playbook, ...renamed })),
      call(retirePlaybook, toAcme(acmeAlphaKeeper, { playbook })),
    ]);

    expect(await Promise.all(attempts)).toEqual([
      accessDenied,
      accessDenied,
      accessDenied,
      accessDenied,
      accessDenied,
      accessDenied,
    ]);
    expect(await call(listPlaybooks, toAcme(acmeAlphaKeeper, { include_retired: true }))).toMatchObject({
      output: { playbooks: [{ id: 'alpha' }] },
    });
    expect(await call(updatePlaybook, toAcme(acmeAlphaKeeper, { playbook: 'alpha', ...renamed }))).toMatchObject({
      output: { id: 'alpha', name: 'Renamed' },
    });
    expect(await call(getPlaybook, toAcme(acmeAdmin, { playbook: 'beta' }))).toMatchObject({
      output: { name: 'Beta', status: 'active' },
    });
  });
});

describe('a caller limited to some playbooks that names none', () => {
  it('is told it may access only some playbooks and to name one, by every operation that takes a playbook', async () => {
    const { call } = harness();
    const unnamed = {
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may access only some playbooks of this org; name one of them in playbook',
    };

    expect(
      await Promise.all([
        call(createPlaybook, toAcme(acmeAlphaKeeper, { name: 'Alpha' })),
        call(getPlaybook, toAcme(acmeAlphaKeeper, {})),
        call(updatePlaybook, toAcme(acmeAlphaKeeper, renamed)),
        call(retirePlaybook, toAcme(acmeAlphaKeeper, {})),
      ]),
    ).toEqual([unnamed, unnamed, unnamed, unnamed]);
  });
});

describe('creating a playbook', () => {
  it('is open to a limited caller only for an id on its list, and to a caller of every playbook for any', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));

    expect(await call(createPlaybook, toAcme(acmeAlphaKeeper, { playbook: 'beta', name: 'Beta' }))).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may not access this playbook',
    });
    expect(await call(createPlaybook, toAcme(acmeAlphaKeeper, { playbook: 'delta', name: 'Delta' }))).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may not access this playbook',
    });
    expect(await call(createPlaybook, toAcme(acmeAlphaKeeper, { playbook: 'alpha', name: 'Alpha' }))).toMatchObject({
      status: 'succeeded',
      output: { id: 'alpha', created_by: { id: 'acme-alpha-keeper', name: 'acme-alpha-keeper' } },
    });
    expect(await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'delta', name: 'Delta' }))).toMatchObject({
      status: 'succeeded',
      output: { id: 'delta', created_by: { id: 'acme-admin', name: 'acme-admin' } },
    });
  });
});

describe('a caller that may only read', () => {
  it('is rejected for the commands and served the queries', async () => {
    const { call } = harness();
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    const readOnly = { status: 'rejected', reason: 'forbidden', detail: 'The caller lacks the org:write permission' };

    expect(await call(createPlaybook, toAcme(acmeReader, { playbook: 'beta', name: 'Beta' }))).toEqual(readOnly);
    expect(await call(updatePlaybook, toAcme(acmeReader, { playbook: 'alpha', ...renamed }))).toEqual(readOnly);
    expect(await call(retirePlaybook, toAcme(acmeReader, { playbook: 'alpha' }))).toEqual(readOnly);
    expect(await call(getPlaybook, toAcme(acmeReader, { playbook: 'alpha' }))).toMatchObject({
      output: { name: 'Alpha', status: 'active' },
    });
    expect(await call(listPlaybooks, toAcme(acmeReader))).toMatchObject({ output: { playbooks: [{ id: 'alpha' }] } });
  });
});
