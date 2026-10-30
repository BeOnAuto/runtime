import { callKeyText } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { waitingRow } from '../calls/call-rows.ts';
import { alpha, at, playbookCreated, recorded } from '../reaction-testing/playbook-writes.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { followedThroughTheLatest, settledIn } from '../waiting-testing/followed-host.ts';
import { parentId, parentRun } from '../waiting-testing/waiting-parent.ts';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const key = callKeyText({ runId: parentRun, reference: '/do/0/ask', run: 1 });

const ending = { type: 'run_succeeded', data: { output: 'checked', record: {} } };

const ofTheChild = {
  by: 'playbook:alpha',
  at,
  runId: child,
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy: { runId: parentId, reference: '/do/0/ask', run: 1 },
};

describe('a host that died after it marked a call waiting and before it read the ending of the call’s run', () => {
  it('leaves the answer to the first resume of the next host, which reads the ending the follower passed over', async () => {
    const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
    const database = await openedOn(settings);
    await playbookCreated(database.store, 'alpha');
    const first = await hostedOn(settings, { answer: () => Effect.never });
    first.know(parentId);
    await Effect.runPromise(first.host.start(runAt(parentId), startOf(asking)));
    await recorded(database.store, `${alpha}runs/${child}`, ending, ofTheChild);
    await followedThroughTheLatest(database);
    await first.host.stop();
    await Effect.runPromise(waitingRow(database, key, { child, at: Date.now() }));

    const second = await hostedOn(settings, { answer: () => Effect.never });
    second.know(parentId);
    const settlement = await settledIn(second)(parentId);

    expect(settlement).toEqual({ status: 'succeeded', output: 'checked' });
    expect(first.settlements().get(parentId)).toBeUndefined();
  });
});
