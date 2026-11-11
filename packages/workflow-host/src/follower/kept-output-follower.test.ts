import { keptIn } from '@on.auto/definitions/testing';
import { messageIdOf, type Context } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  alpha,
  at,
  definitionRecorded,
  eventTrigger,
  published,
  recorded,
} from '../reaction-testing/playbook-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../testing/until.ts';

const owner = { org: 'acme', playbook: 'alpha' };

const output = { report: 'r'.repeat(40_000) };

const ofTheReport: Context = {
  at,
  by: 'acme-admin',
  runId: 'r-1',
  definitionType: 'workflow',
  definitionName: 'report',
  definitionVersion: 1,
};

async function succeededKeeping(keeps: boolean) {
  const reacting = await reactingHost();
  const { store, content } = reacting.database;
  await definitionRecorded(store, {
    name: 'watch',
    version: 1,
    triggers: [eventTrigger({ type: 'run_succeeded' }, { type: 'com.acme.sentinel' })],
  });
  const { sha256, bytes } = await Effect.runPromise(
    keptIn(keeps ? content : memoryLedger().service.content, owner, output),
  );
  await recorded(
    store,
    `${alpha}runs/r-1`,
    { type: 'run_succeeded', data: { output_sha256: sha256, output_bytes: bytes, record: {} } },
    ofTheReport,
  );
  await published(store, { id: 's1', type: 'com.acme.sentinel' });
  await until(
    () => Promise.resolve(reacting.reactions.starts()),
    (starts) => starts.some(({ cause }) => cause === messageIdOf(`${alpha}events/s1`, 1)),
  );
  return reacting;
}

describe('a run’s success whose output its playbook keeps outside, as the follower meets it', () => {
  it('starts the workflow it triggers with the whole output, read from the playbook’s content', async () => {
    const reacting = await succeededKeeping(true);

    const [start] = reacting.reactions.starts();

    expect(start?.input).toMatchObject([{ type: 'run_succeeded', data: { output } }]);
  });

  it('is passed over by the triggers and said once, where its output is missing from the content', async () => {
    const reacting = await succeededKeeping(false);

    expect(reacting.reactions.starts().map(({ cause }) => cause)).toEqual([messageIdOf(`${alpha}events/s1`, 1)]);
    expect(reacting.notes()).toMatchObject([
      { kind: 'record_content_missing', org: 'acme', playbook: 'alpha', type: 'run_succeeded', passedBy: 'reactions' },
    ]);
  });
});
