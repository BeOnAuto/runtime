import { Effect } from 'effect';
import { expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const approval = workflow(`
do:
  - pause: { wait: PT0.05S }
  - notify: { call: notify, with: { to: ada } }
  - approval: { listen: { to: { one: { with: { type: com.acme.approved } } } } }
`);

const approved = { id: 'approved-1', type: 'com.acme.approved', data: { by: 'grace' } };

export function runSuite(settings: SettingsOf): void {
  it('waits, calls a function, takes an event and ends, settling its run once', async () => {
    const hosted = await hostedOn(await settings());
    hosted.know(runId);
    const run = runAt(runId);

    const started = await Effect.runPromise(hosted.host.start(run, startOf(approval)));
    await until(hosted.calls, (calls) => calls.length > 0);
    const delivered = await Effect.runPromise(hosted.host.deliver(run, approved));
    const settlements = await until(hosted.settlements, (settled) => settled.size > 0);
    const again = await Effect.runPromise(hosted.host.deliver(run, { ...approved, id: 'approved-2' }));
    const startedAgain = await Effect.runPromise(hosted.host.start(run, startOf(approval)));

    expect([started, delivered, again, startedAgain]).toEqual(['started', 'delivered', 'ended', 'settled']);
    expect(hosted.calls()).toEqual([expect.objectContaining({ function: 'notify', arguments: { to: 'ada' } })]);
    expect([...settlements]).toEqual([[runId, { status: 'succeeded', output: [{ by: 'grace' }] }]]);
    expect(hosted.troubles()).toEqual([]);
  });
}
