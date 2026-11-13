import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { RecordedStore } from '../event-store.ts';
import { planOf } from '../recorded/sqlite-checks.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import type { RecordedKeys } from './recorded-keys.ts';

const alpha = 'playbook/acme/alpha/';

const triage = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/';

const ofOneKey: RecordedKeys = { org: 'acme', keys: [alpha] };

const ofTwoKeys: RecordedKeys = { org: 'acme', keys: [alpha, triage] };

const PlanSteps = Schema.Array(
  Schema.Struct({
    rows: Schema.Array(Schema.Struct({ id: Schema.Number, parent: Schema.Number, detail: Schema.String })),
  }),
);

interface PlanStep {
  readonly id: number;
  readonly parent: number;
  readonly detail: string;
}

interface Planned {
  readonly text: string;
  readonly steps: readonly PlanStep[];
}

async function aMigratedFile(): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const store = sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName }));
  await store.migrate();
  await store.close();
  return fileName;
}

async function plannedOn(read: (store: RecordedStore) => Promise<unknown>): Promise<Planned> {
  const text = await planOf(await aMigratedFile(), read);
  return { text, steps: Schema.decodeUnknownSync(Schema.fromJsonString(PlanSteps))(text).flatMap(({ rows }) => rows) };
}

function underEachWalk({ steps }: Planned): readonly string[] {
  const walks = new Set(steps.filter(({ detail }) => detail === 'CORRELATED LIST SUBQUERY 1').map(({ id }) => id));
  return steps.filter(({ parent }) => walks.has(parent)).map(({ detail }) => detail);
}

describe('the plans of the reads over keys on SQLite', () => {
  it("read one key by equality, as before, and walk several keys in turn, each through the key's index in order, bounded", async () => {
    const one = await plannedOn((store) =>
      store.readRecordedOfKeys(ofOneKey, { kind: 'everything' }, { order: 'desc', limit: 5 }),
    );
    const several = await plannedOn((store) =>
      store.readRecordedOfKeys(ofTwoKeys, { kind: 'everything' }, { order: 'desc', limit: 5 }),
    );
    const since = await plannedOn((store) =>
      store.readRecordedOfKeys(
        ofTwoKeys,
        { kind: 'everything' },
        { order: 'asc', limit: 5, since: '2026-11-01T00:00:00.000Z' },
      ),
    );

    expect(one.text).toContain('USING INDEX ledger_messages_by_playbook (<expr>=?)');
    expect(one.text).not.toContain('LIST SUBQUERY');
    expect(underEachWalk(several)).toEqual(['SEARCH emt_messages USING INDEX ledger_messages_by_playbook (<expr>=?)']);
    expect(underEachWalk(since)).toEqual([
      'SEARCH emt_messages USING INDEX ledger_messages_by_playbook_and_time (<expr>=? AND created>?)',
    ]);
  });

  it('walk the runs of several keys through the index of first messages by kind, and a run of several keys through the index of each stream', async () => {
    const runs = await plannedOn((store) =>
      store.readRecordedOfKeys(ofTwoKeys, { kind: 'runs' }, { order: 'desc', limit: 5 }),
    );
    const run = await plannedOn((store) =>
      store.readRecordedOfKeys(ofTwoKeys, { kind: 'run', run: 'r1' }, { order: 'asc', limit: 5 }),
    );

    expect(underEachWalk(runs)).toEqual(['SEARCH emt_messages USING INDEX ledger_first_messages_by_kind (<expr>=?)']);
    expect(underEachWalk(run)).toEqual(['SEARCH emt_messages USING INDEX ledger_messages_by_stream (stream_id=?)']);
  });

  it("read the tree of a run and one event through the org's indexes", async () => {
    const tree = await plannedOn((store) =>
      store.readRecordedOfKeys(ofTwoKeys, { kind: 'correlated', correlation: 'r1' }, { order: 'asc', limit: 5 }),
    );
    const event = await plannedOn((store) => store.readRecordedEventOfKeys(ofTwoKeys, 'message-1'));

    expect(tree.text).toContain('USING INDEX ledger_messages_by_org_and_correlation (<expr>=? AND <expr>=?)');
    expect(event.text).toContain('USING INDEX ledger_messages_by_org_and_id (<expr>=? AND message_id=?)');
  });
});
