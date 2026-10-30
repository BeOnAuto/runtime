import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { harness, toPlaybook, toOrg } from '../testing/harness.ts';
import { peekPlaybookCommand, peekPlaybookQuery, peekOrgCommand, peekOrgQuery } from '../testing/probes.ts';

describe('a handler at run time', () => {
  it('sees the caller, the address and the ports of its call, with the writer for commands only', async () => {
    const { dispatcher, run } = harness();
    const toAcme = toOrg('acme');
    const toAlpha = toPlaybook('acme', 'alpha');
    const view = { caller: 'acme-admin', org: 'acme' };
    const inAlpha = { ...view, playbook: 'alpha', status: 'active' };

    expect(await run(dispatcher.dispatchToOrg(peekOrgQuery.registration, toAcme(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...view, visible: ['Caller', 'OrgContext', 'OrgReader'] },
    });
    expect(await run(dispatcher.dispatchToOrg(peekOrgCommand.registration, toAcme(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...view, visible: ['Caller', 'OrgContext', 'OrgReader', 'OrgWriter'] },
    });
    expect(await run(dispatcher.dispatchToPlaybook(peekPlaybookQuery.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...inAlpha, visible: ['Caller', 'PlaybookContext', 'PlaybookLifecycle', 'PlaybookReader'] },
    });
    expect(await run(dispatcher.dispatchToPlaybook(peekPlaybookCommand.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: {
        ...inAlpha,
        visible: ['Caller', 'PlaybookContext', 'PlaybookLifecycle', 'PlaybookReader', 'PlaybookWriter'],
      },
    });
  });

  it('sees the status of its playbook as the registry gives it, retired for a query that a retired playbook answers', async () => {
    const { dispatcher, run } = harness({ retiredPlaybooks: [{ org: 'acme', playbook: 'old' }] });

    expect(
      await run(dispatcher.dispatchToPlaybook(peekPlaybookQuery.registration, toPlaybook('acme', 'old')(acmeAdmin))),
    ).toMatchObject({
      status: 'succeeded',
      output: { playbook: 'old', status: 'retired' },
    });
  });
});
