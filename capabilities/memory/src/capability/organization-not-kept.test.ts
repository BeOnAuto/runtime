import { describe, expect, it } from 'vitest';

import { idOf, memoryHarness, recallDocument, rememberDocument } from '../testing/index.ts';

const notKept = 'Organization-wide memories are not available here yet: keep it for the playbook, with scope playbook';

function keepingNoOrganization() {
  return memoryHarness({ organization: 'none' });
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

describe('the memories a server that keeps none of the organization lists and forgets', () => {
  it("are the playbook's own, and an id it does not keep is found in neither scope", async () => {
    const harness = keepingNoOrganization();
    const id = await harness.rememberedId({ text: 'Drafts go out on Mondays' });

    const listed = await harness.call(harness.operations.listMemories, {});
    const forgotten = await harness.call(harness.operations.forget, { id });
    const unknown = await harness.call(harness.operations.forget, { id: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a' });

    expect(listed).toMatchObject({ status: 'succeeded', output: { memories: [{ id, scope: 'playbook' }] } });
    expect(forgotten).toMatchObject({ status: 'succeeded', output: { id, scope: 'playbook', status: 'forgotten' } });
    expect(unknown).toMatchObject({ status: 'rejected', reason: 'not_found' });
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
