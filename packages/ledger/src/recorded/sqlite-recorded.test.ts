import { DatabaseSync } from 'node:sqlite';

import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { cursorWithin, InvalidCursor, type RecordedSelection } from '@on.auto/operations';
import type { HeldName } from '@on.auto/operations/definition-names';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { nodeSqliteEventStoreDriver } from '../connection/node-sqlite-event-store-driver.ts';
import { orgStreamsQuery } from '../definitions/sqlite-definition-reads.ts';
import type { DefinitionNamesStore, RecordedStore, StoredRecord } from '../event-store.ts';
import type { OrgPageAsked, RecordedKeys } from '../keys/recorded-keys.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { cursorOf } from './cursor.ts';
import type { IndexExecutor } from './missing-indexes.ts';
import { orgRecordedReaderOf, recordedEventReaderOf, recordedReaderOf } from './recorded-reader.ts';
import { executedOn, planOf } from './sqlite-checks.ts';
import { createSQLitePlaybookIndexes, orgOfStream } from './sqlite-indexes.ts';
import { sqliteRecordedStore } from './sqlite-recorded.ts';

const playbookIndexes = [
  'ledger_definition_streams',
  'ledger_first_messages_by_kind',
  'ledger_messages_by_org',
  'ledger_messages_by_org_and_correlation',
  'ledger_messages_by_org_and_id',
  'ledger_messages_by_playbook',
  'ledger_messages_by_playbook_and_time',
  'ledger_messages_by_stream',
];

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

function indexesOf(fileName: string): readonly string[] {
  const database = new DatabaseSync(fileName, { readOnly: true });
  onTestFinished(() => {
    database.close();
  });
  const listed = database
    .prepare(
      "SELECT group_concat(name, ' ') AS names FROM (SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ledger%' ORDER BY name)",
    )
    .get()?.['names'];
  return String(listed).split(' ');
}

function executorFinding(names: readonly string[]): { readonly execute: IndexExecutor; readonly commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: () => Promise.resolve({ rows: names.map((name) => ({ name })) }),
      command: (sql) => {
        commands.push(SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' '));
        return Promise.resolve();
      },
    },
  };
}

async function migratedOnce(fileName: string): Promise<void> {
  const store = sqliteEventStore(() => ({ driver: nodeSqliteEventStoreDriver, fileName }));
  await store.migrate();
  await store.close();
}

const at = '2026-10-05T09:00:00.000Z';

const context = { at, by: 'tester' };

const untraced: StoredRecord = {
  id: 'message-21',
  causationId: null,
  correlationId: 'r1',
  point: ['21'],
  stream: 'playbook/acme/alpha/runs/r1',
  version: 1,
  globalPosition: 21,
  type: 'run_started',
  data: { input: {} },
  metadata: { context },
  recordedAt: at,
};

interface Holding {
  readonly store: RecordedStore & Pick<DefinitionNamesStore, 'definitionsIn' | 'holdersOfName'>;
  readonly asked: readonly RecordedKeys[];
  readonly selected: readonly RecordedSelection[];
}

function heldAs(definitionKey: string, definitionType: string): HeldName {
  return {
    definitionKey,
    definitionType,
    name: 'weekly',
    playbookKey: 'playbook/acme/alpha/',
    status: 'active',
    hasTriggers: false,
  };
}

const holdersOfWeekly = [heldAs('definition/acme/d1/', 'workflow'), heldAs('definition/acme/d2/', 'reasoning')];

function storeHolding(record: StoredRecord, definitions: readonly string[] = []): Holding {
  const asked: RecordedKeys[] = [];
  const selected: RecordedSelection[] = [];
  const store: RecordedStore & Pick<DefinitionNamesStore, 'definitionsIn' | 'holdersOfName'> = {
    definitionsIn: (playbookKey) => Promise.resolve(playbookKey === 'playbook/acme/alpha/' ? definitions : []),
    holdersOfName: ({ playbookKey, name }) =>
      Promise.resolve(playbookKey === 'playbook/acme/alpha/' && name === 'weekly' ? holdersOfWeekly : []),
    pointLength: 1,
    readRecorded: () => Promise.reject(new Error('A read by the text of a key is not asked here')),
    readAppended: () => Promise.resolve({ streams: [], through: ['21'], more: false }),
    readAppendedFacts: () => Promise.resolve({ held: false }),
    readRecordedEvent: () => Promise.reject(new Error('A read by the text of a key is not asked here')),
    readRecordedOfOrg: () => Promise.reject(new Error('A read of an org is not asked here')),
    readRecordedOfKeys: (keys, selection) => {
      asked.push(keys);
      selected.push(selection);
      return Promise.resolve({ records: [record] });
    },
    readRecordedEventOfKeys: (keys, id) => {
      asked.push(keys);
      return Promise.resolve(id === record.id ? record : undefined);
    },
  };
  return { store, asked, selected };
}

const alpha = { org: 'acme', playbook: 'alpha' };

const theKeysOfAlpha: RecordedKeys = { org: 'acme', keys: ['playbook/acme/alpha/'] };

const sixStreams = {
  kind: 'streams',
  streams: [
    'org/acme/playbooks',
    'org/acme/playbooks/',
    'org/acme/connections',
    'org/acme/connections/',
    'org/acme/comments',
    'org/acme/comments/',
  ],
} as const;

async function appendedInTurn(fileName: string, streams: readonly string[]): Promise<void> {
  const store = sqliteEventStore(() => ({ driver: nodeSqliteEventStoreDriver, fileName }));
  await store.migrate();
  await streams.reduce(async (before: Promise<unknown>, stream) => {
    await before;
    return store.append(stream, [{ type: 'noted', data: {} }], {
      expectedVersion: 0,
      context: { at: '2026-11-02T09:00:00.000Z', by: 'tester' },
    });
  }, Promise.resolve());
  await store.close();
}

describe("the playbook's indexes on SQLite", () => {
  it('are created when the store migrates, as the ledger opens, once however often it migrates', async () => {
    const fileName = aDatabaseFile();
    await migratedOnce(fileName);
    await migratedOnce(fileName);

    expect(indexesOf(fileName)).toEqual(playbookIndexes);
  });

  it('are created only when missing, so a start that finds them issues no CREATE', async () => {
    const present = executorFinding(playbookIndexes);
    const oneMissing = executorFinding(playbookIndexes.filter((name) => name !== 'ledger_messages_by_stream'));

    await createSQLitePlaybookIndexes(present.execute);
    await createSQLitePlaybookIndexes(oneMissing.execute);

    expect([present.commands, oneMissing.commands]).toEqual([
      [],
      ['CREATE INDEX IF NOT EXISTS ledger_messages_by_stream ON emt_messages (stream_id, global_position)'],
    ]);
  });
});

describe('an event store on SQLite given hooks of its own', () => {
  it('keeps its hook, which runs after the schema is created, and still creates the indexes', async () => {
    const fileName = aDatabaseFile();
    const hooked: string[] = [];
    const store = sqliteEventStore(() => ({
      driver: nodeSqliteEventStoreDriver,
      fileName,
      hooks: {
        onAfterSchemaCreated: () => {
          hooked.push('after the schema');
        },
      },
    }));
    onTestFinished(() => store.close());

    await store.migrate();

    expect([hooked, indexesOf(fileName)]).toEqual([['after the schema'], playbookIndexes]);
  });

  it('keeps its hook that runs before each commit', async () => {
    const hooked: string[] = [];
    const store = sqliteEventStore(() => ({
      driver: nodeSqliteEventStoreDriver,
      fileName: aDatabaseFile(),
      hooks: {
        onBeforeCommit: (messages: readonly unknown[]) => {
          hooked.push(`before a commit of ${messages.length}`);
          return Promise.resolve();
        },
      },
    }));
    onTestFinished(() => store.close());
    await store.migrate();

    await store.append('org/acme/notes', [{ type: 'noted', data: {} }], {
      expectedVersion: 0,
      context: { at: '2026-10-05T09:00:00.000Z', by: 'tester' },
    });

    expect(hooked).toEqual(['before a commit of 1']);
  });
});

describe('the read of one message by its id on SQLite', () => {
  it('walks the index on the org and the message id', async () => {
    const fileName = aDatabaseFile();
    await migratedOnce(fileName);
    const database = new DatabaseSync(fileName, { readOnly: true });
    onTestFinished(() => {
      database.close();
    });

    const plan = database
      .prepare(
        SQL.describe(
          SQL`EXPLAIN QUERY PLAN SELECT global_position FROM emt_messages
            WHERE ${orgOfStream} = 'acme' AND message_id = 'id' AND partition = 'emt:default'`,
          sqliteFormatter,
        ),
      )
      .all()
      .map((row: Readonly<Record<string, unknown>>) => String(row['detail']));

    expect(plan.join(' ')).toContain('USING INDEX ledger_messages_by_org_and_id');
  });
});

describe("the read of the orgs' streams of a name on SQLite", () => {
  it('steps from one org to the next through the index on the org, and finds each stream by the key of the streams', async () => {
    const fileName = aDatabaseFile();
    await migratedOnce(fileName);

    const plan = await executedOn(fileName, async (execute) =>
      (await execute.query(SQL`EXPLAIN QUERY PLAN ${orgStreamsQuery('connections')}`)).rows.map(
        (row: Readonly<Record<string, unknown>>) => String(row['detail']),
      ),
    );

    expect(plan).toContain('SEARCH emt_messages USING COVERING INDEX ledger_messages_by_org (<expr>>?)');
    expect(plan).toContain(
      'SEARCH s USING INDEX sqlite_autoindex_emt_streams_1 (stream_id=? AND partition=? AND is_archived=?)',
    );
    expect(plan.filter((step) => /^SCAN (?:emt_|s$)/u.test(step))).toEqual([]);
  });
});

describe('the reads of a playbook', () => {
  it("ask the store for the playbook's key under the org its address names", async () => {
    const { store, asked } = storeHolding(untraced);

    const page = await Effect.runPromise(
      recordedReaderOf(store)(alpha, { kind: 'correlated', correlation: 'r1' }, { order: 'desc', limit: 5 }),
    );
    await Effect.runPromise(recordedEventReaderOf(store)(alpha, 'message-21'));

    expect(page.records.map(({ id }) => id)).toEqual(['message-21']);
    expect(asked).toEqual([theKeysOfAlpha, theKeysOfAlpha]);
  });

  it('ask for the keys of the definitions that hold a name in the playbook too, after its own', async () => {
    const { store, asked } = storeHolding(untraced, ['definition/acme/d1/', 'definition/acme/d2/']);

    await Effect.runPromise(recordedReaderOf(store)(alpha, { kind: 'everything' }, { order: 'asc', limit: 5 }));
    await Effect.runPromise(recordedEventReaderOf(store)(alpha, 'message-21'));

    const ofItsDefinitions = {
      org: 'acme',
      keys: ['playbook/acme/alpha/', 'definition/acme/d1/', 'definition/acme/d2/'],
    };
    expect(asked).toEqual([ofItsDefinitions, ofItsDefinitions]);
  });

  it('read the runs of a name under the keys of the definitions that hold it now, of the type asked, and none where none does', async () => {
    const { store, asked, selected } = storeHolding(untraced, ['definition/acme/d1/', 'definition/acme/d2/']);
    const read = (selection: RecordedSelection) =>
      Effect.runPromise(recordedReaderOf(store)(alpha, selection, { order: 'desc', limit: 5 }));

    const pages = [
      await read({ kind: 'runs', name: 'weekly' }),
      await read({ kind: 'runs', definitionType: 'workflow', name: 'weekly', called: false }),
      await read({ kind: 'runs', name: 'monthly' }),
    ];

    expect(pages.map(({ records, hasMore }) => [records.length, hasMore])).toEqual([
      [1, false],
      [1, false],
      [0, false],
    ]);
    expect(asked.map(({ keys }) => keys)).toEqual([
      ['definition/acme/d1/', 'definition/acme/d2/'],
      ['definition/acme/d1/'],
    ]);
    expect(selected).toEqual([{ kind: 'runs' }, { kind: 'runs', definitionType: 'workflow', called: false }]);
  });
});

describe('one record read by its id', () => {
  it('carries no page cursor, no trace and no span when its store kept none, and is nothing for an id the store does not hold', async () => {
    const read = recordedEventReaderOf(storeHolding(untraced).store);

    const [found, missing] = await Effect.runPromise(
      Effect.all([read(alpha, 'message-21'), read(alpha, 'message-99')]),
    );

    expect(found).toEqual({
      id: 'message-21',
      causationId: null,
      correlationId: 'r1',
      stream: 'playbook/acme/alpha/runs/r1',
      version: 1,
      globalPosition: 21,
      type: 'run_started',
      data: { input: {} },
      context,
      recordedAt: at,
    });
    expect(missing).toBeUndefined();
  });
});

type OrgStore = Pick<RecordedStore, 'readRecordedOfOrg' | 'pointLength'>;

function orgStoreAnswering(record: StoredRecord) {
  const asked: OrgPageAsked[] = [];
  const store: OrgStore = {
    pointLength: 1,
    readRecordedOfOrg: (org, page) => {
      asked.push(page);
      return Promise.resolve(org === 'acme' ? { records: [record], resumeAfter: record.point } : { records: [] });
    },
  };
  return { store, asked };
}

function refusalsOfAlphasCursors(store: OrgStore): Promise<readonly InvalidCursor[]> {
  const read = orgRecordedReaderOf(store);
  const ofAlpha = cursorOf('playbook/acme/alpha/', ['20']);
  return Effect.runPromise(
    Effect.all([
      Effect.flip(read('acme', { order: 'asc', limit: 5, cursor: ofAlpha })),
      Effect.flip(read('acme', { order: 'asc', limit: 5, through: ofAlpha })),
    ]),
  );
}

describe("the read of an org's records", () => {
  it("answers each record's cursor under the org, read after the place its cursor names and through the place it is read through", async () => {
    const { store, asked } = orgStoreAnswering(untraced);

    const page = await Effect.runPromise(
      orgRecordedReaderOf(store)('acme', {
        order: 'asc',
        limit: 5,
        cursor: cursorOf('acme', ['20']),
        through: cursorOf('acme', ['30']),
      }),
    );

    expect(asked).toEqual([{ order: 'asc', limit: 5, after: ['20'], to: ['30'] }]);
    expect(page.records.map(({ cursor }) => cursor)).toEqual([cursorOf('acme', ['21'])]);
    expect(page.nextCursor).toBe(cursorOf('acme', ['21']));
  });

  it('reads at the record a cursor within a record names, and from the start with no cursor', async () => {
    const { store, asked } = orgStoreAnswering(untraced);
    const read = orgRecordedReaderOf(store);

    await Effect.runPromise(
      read('acme', { order: 'asc', limit: 5, cursor: cursorWithin(cursorOf('acme', ['21']), 0) }),
    );
    await Effect.runPromise(read('acme', { order: 'asc', limit: 5 }));

    expect(asked).toEqual([
      { order: 'asc', limit: 5, at: ['21'] },
      { order: 'asc', limit: 5 },
    ]);
  });

  it('refuses a cursor or a place to read through that another key names', async () => {
    const { store, asked } = orgStoreAnswering(untraced);

    const refused = await refusalsOfAlphasCursors(store);

    expect(refused).toEqual([
      new InvalidCursor({ kind: 'of_another_playbook' }),
      new InvalidCursor({ kind: 'of_another_playbook' }),
    ]);
    expect(asked).toEqual([]);
  });
});

describe('a read of several streams on SQLite', () => {
  it('reads six streams, whole names and kinds, in one select of no compound, each through its index, in the order they were appended to', async () => {
    const fileName = aDatabaseFile();
    await appendedInTurn(fileName, [
      'org/acme/playbooks',
      'org/acme/connections/first',
      'org/acme/activity/seen',
      'org/acme/comments/first',
      'org/beta/comments/first',
      'org/acme/connections',
      'org/acme/comments/second',
    ]);
    const asked: string[] = [];

    const read = await executedOn(fileName, (execute) =>
      sqliteRecordedStore({
        ...execute,
        query: (sql) => {
          asked.push(SQL.describe(sql, sqliteFormatter));
          return execute.query(sql);
        },
      }).readAppendedFacts(sixStreams, { after: null, most: 100, dataOf: [] }),
    );
    const ofTheStreams = asked.filter((text) => text.includes('stream_id = '));
    const plan = await planOf(fileName, (store) =>
      store.readAppendedFacts(sixStreams, { after: null, most: 100, dataOf: [] }),
    );

    expect(read).toMatchObject({
      held: true,
      facts: [
        { stream: 'org/acme/playbooks' },
        { stream: 'org/acme/connections/first' },
        { stream: 'org/acme/comments/first' },
        { stream: 'org/acme/connections' },
        { stream: 'org/acme/comments/second' },
      ],
    });
    expect(ofTheStreams).toHaveLength(1);
    expect(ofTheStreams.join()).not.toContain('UNION');
    expect(ofTheStreams.join().split('FROM emt_messages')).toHaveLength(2);
    expect(ofTheStreams.join().match(/ = "org\/acme\/[a-z]+\/?"(?: OR|\))/gu)).toHaveLength(6);
    expect(plan).toContain('MULTI-INDEX OR');
    expect(plan.match(/USING INDEX ledger_messages_by_(?:stream|playbook) /gu)).toHaveLength(6);
  });
});
