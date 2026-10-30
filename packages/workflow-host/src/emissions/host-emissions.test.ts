import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { until } from '../testing/until.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const announcing = workflow(`do:
  - notify: { call: notify, with: { to: ada } }
  - announce: { emit: { event: { with: { type: com.acme.closed, source: /acme/ledger, data: { month: september } } } } }
`);

describe('a workflow run by the host that emits an event', () => {
  it('hands the event to the playbook as emitted by the run and its workflow, one deeper than the run', async () => {
    const reacting = await reactingHost();
    const start = startOf(announcing);
    const attributes = { ...start.attributes, definition: { name: 'close', version: 3 }, caller: { id: 'acme-admin' } };

    await Effect.runPromise(reacting.host.start(runAt(runId), { ...start, attributes }));
    const emissions = await until(
      () => Promise.resolve(reacting.reactions.emissions()),
      (found) => found.length > 0,
    );

    expect(emissions).toMatchObject([
      {
        event: { type: 'com.acme.closed', source: '/acme/ledger', data: { month: 'september' } },
        emitter: { run_id: runId, workflow: 'close', version: 3 },
        depth: 1,
        by: 'acme-admin',
      },
    ]);
  });
});
