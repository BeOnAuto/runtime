import { describe, expect, it } from 'vitest';

import { idOf, memoryHarness, recallDocument, rememberDocument } from '../testing/index.ts';

const notKept = 'Organization-wide memories are not available here yet: keep it for the playbook, with scope playbook';

function keepingNoOrganization() {
  return memoryHarness({ organizationKept: false });
}

describe('a server that keeps no memories of the organization', () => {
  it('refuses to remember or move a memory for the organization at the field that names it, and keeps it for the playbook', async () => {
    const harness = keepingNoOrganization();

    const refused = await harness.call(harness.operations.remember, {
      text: 'Budgets need two approvals',
      scope: 'organization',
    });
    const kept = await harness.call(harness.operations.remember, { text: 'Drafts go out on Mondays' });
    const moved = await harness.call(harness.operations.moveMemory, { id: idOf(kept), to: 'organization' });

    expect([refused, moved]).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: notKept,
        issues: [{ pointer: '/scope', detail: notKept }],
      },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/to', detail: notKept }] },
    ]);
    expect(kept).toMatchObject({ status: 'succeeded', output: { scope: 'playbook' } });
  });

  it('recalls the memories of the playbook alone, whatever scope is asked, and says nothing of the organization', async () => {
    const harness = keepingNoOrganization();
    await harness.call(harness.operations.remember, { text: 'Drafts go out on Mondays' });

    const recalled = await Promise.all(
      ['both', 'organization', 'playbook'].map((scope) => harness.call(harness.operations.recall, { scope })),
    );

    expect(recalled).toMatchObject([
      { status: 'succeeded', output: { memories: [{ scope: 'playbook' }] } },
      { status: 'succeeded', output: { memories: [] } },
      { status: 'succeeded', output: { memories: [{ scope: 'playbook' }] } },
    ]);
  });
});

describe('a memory function of a server that keeps no memories of the organization', () => {
  it('refuses to save a memory function that remembers for the organization, at the line of its scope, and saves one that recalls', async () => {
    const harness = keepingNoOrganization();

    const remembering = await harness.define('keep-for-everyone', rememberDocument(['scope: organization']));
    const recalling = await harness.define('recall-everything', recallDocument(['scope: both']));
    const keeping = await harness.define('keep-for-the-playbook', rememberDocument(['scope: playbook']));

    expect(remembering).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/source', detail: `Line 10, /remember/scope: ${notKept}` }],
    });
    expect([recalling, keeping]).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
  });
});
