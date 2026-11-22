import { textToKeep } from '@on.auto/content';
import { at } from '@on.auto/content/testing';
import { keptContentGraceMs, type Ledger } from '@on.auto/operations';
import { heldNotes, noteHolders, topicFacts, topicRows } from '@on.auto/operations/testing';
import { Clock, Effect } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { postgresqlMostBoundValues } from '../connection/bound-values.ts';
import { thePlaybookIndexes } from '../postgresql-reads/index-checks.ts';
import { postgresqlRecordedStore, type Query } from '../postgresql-reads/postgresql-recorded.ts';
import { details, happenings } from '../testing/happenings.ts';
import { openConnectionWith, type OpenLedger, openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlConnected, postgresqlDatabasesOn, postgresqlQueried } from '../testing/postgresql-databases.ts';
import { aStatementGate, type StatementGate } from '../testing/statement-gate.ts';
import { valuesListOf } from '../testing/values-list.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

type RecordedSelection = Parameters<OpenLedger['ledger']['readRecorded']>[1];

const alpha = { org: 'acme', playbook: 'alpha' };

const noMetadata: Readonly<Record<string, string>> = {};

const stampedAsStored = { at: '2026-10-05T09:00:00.000Z', by: 'tester' };

async function anAppendLeftOpen(database: string, stream: string, type: string, meta = noMetadata): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY[$4::jsonb], ARRAY['1'], ARRAY[$2], ARRAY['E'], $3, 'playbook', 0, 'emt:default')`,
    [{ json: JSON.stringify({ detail: 'late' }) }, type, stream, { ...stampedAsStored, ...meta }],
  );
  return client;
}

type OpenWrite = { readonly client: Client; readonly id: string };

async function aWriteLeftOpenElsewhere(): Promise<OpenWrite> {
  const client = new Client({ connectionString: server });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  const { rows } = await client.query<{ readonly id: string }>('SELECT pg_current_xact_id()::text AS id');
  return { client, id: rows[0]?.id ?? '' };
}

async function aReaderEndingTheWriteMidway(database: string, endTheWrite: () => Promise<unknown>): Promise<Query> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  const answered = async (text: string, values: readonly unknown[]) =>
    (await client.query<Readonly<Record<string, unknown>>>(text, [...values])).rows;
  const write = { open: true };
  return async (text, values) => {
    if (!write.open || !text.includes('FROM emt_messages')) {
      return answered(text, values);
    }
    write.open = false;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('SELECT 1');
    await endTheWrite();
    const rows = await answered(text, values);
    await client.query('COMMIT');
    return rows;
  };
}

function reading(ledger: OpenLedger['ledger'], selection: RecordedSelection, order: 'asc' | 'desc', cursor?: string) {
  return Effect.runPromise(
    ledger.readRecorded(alpha, selection, { order, limit: 10, ...(cursor === undefined ? {} : { cursor }) }),
  );
}

function noting(ledger: OpenLedger['ledger'], stream: string, type: string, detail: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(`playbook/acme/alpha/${stream}`, happenings, [{ type, data: { detail } }]));
}

const root = 'playbook/acme/alpha/runs/root';

const ofTheRoot = { causationId: null, correlationId: 'root' };

function notingOfRoot(ledger: OpenLedger['ledger'], type: string, detail: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(root, happenings, [{ type, data: { detail } }], ofTheRoot));
}

type OwnLedger = { readonly database: string; readonly ledger: OpenLedger['ledger'] };

async function aLedgerOnItsOwnDatabase(): Promise<OwnLedger> {
  const database = await aDatabase();
  const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
  onTestFinished(dispose);
  return { database, ledger };
}

const everything: RecordedSelection = { kind: 'everything' };

const runs: RecordedSelection = { kind: 'runs' };

function appendedTo(ledger: OpenLedger['ledger'], after?: string) {
  const asked = { most: 10, dataOf: [], ...(after === undefined ? {} : { after }) };
  return Effect.runPromise(ledger.readAppendedFacts({ kind: 'playbook', playbook: alpha }, asked));
}

async function waitedFor(ledger: OpenLedger['ledger'], through: string): Promise<void> {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + 20_000;
  await Effect.runPromise(ledger.waitForAppend({ kind: 'playbook', playbook: alpha }, through, deadline));
}

const readsOldestFirst: readonly (readonly [string, RecordedSelection])[] = [
  ['a page of the playbook', everything],
  ['a list of runs', runs],
];

async function rowLockedNow(database: string, table: string, key: string): Promise<string> {
  const client = await postgresqlConnected(database);
  await client.query('BEGIN');
  try {
    await client.query(`SELECT 1 FROM ${table} WHERE row_key = $1 FOR UPDATE NOWAIT`, [key]);
    return 'free';
  } catch (error) {
    return String(error);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function heldNow(database: string, lock: string): Promise<boolean> {
  const probing = await postgresqlConnected(database);
  const { rows } = await probing.query<{ readonly free: boolean }>(
    'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS free',
    [lock],
  );
  await probing.query('SELECT pg_advisory_unlock_all()');
  return rows[0]?.free === false;
}

const aRowLockAsked = 'topics_2:playbook/acme/alpha/spring';

const aRowRead = 'SELECT topic, note, last_message';

async function aLedgerOfTopics(
  gate: StatementGate,
): Promise<{ readonly database: string; readonly ledger: Ledger['Service'] }> {
  const database = await aDatabase();
  const { ledger, dispose } = await openLedgerWith(
    postgresqlLedgerLayer({ pools: gate.pools(database), projections: [topicRows] }),
  );
  onTestFinished(dispose);
  await Effect.runPromise(
    ledger.execute('playbook/acme/alpha/runs/r1', topicFacts, [
      { type: 'topic_opened', data: { topic: 'spring', at: 1000 } },
    ]),
  );
  return { database, ledger };
}

const springOf = "SELECT note, next_at FROM topics_2 WHERE row_key = 'spring'";

const prefix = 'playbook/acme/alpha/';

const orgKey = 'org/acme/';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const pastItsHour = keptAt + keptContentGraceMs + 1;

async function aLedgerHolding(database: string, gate: StatementGate) {
  const { ledger, dispose } = await openLedgerWith(
    postgresqlLedgerLayer({ pools: gate.pools(database), holders: noteHolders }),
  );
  onTestFinished(dispose);
  const { sha256 } = await at(keptAt, ledger.content.put(alpha, textToKeep('{"note":1}', 'application/json')));
  return { ledger, sha256 };
}

function digestLockOf(sha256: string): string {
  return `content_references_2:${orgKey}${sha256}`;
}

async function theDigestLockedBy(database: string, sha256: string): ReturnType<typeof postgresqlConnected> {
  const holding = await postgresqlConnected(database);
  await holding.query('BEGIN');
  await holding.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [digestLockOf(sha256)]);
  return holding;
}

async function aLedgerOnItsOwnDatabasePlaybookIndexesPostgresql(): Promise<string> {
  const database = await aDatabase();
  const { dispose } = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
  onTestFinished(dispose);
  return database;
}

async function anAppendLeftOpenPlaybookIndexesPostgresql(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY[$3::jsonb], ARRAY['1'], ARRAY['noted'], ARRAY['E'], $2, 'playbook', 0, 'emt:default')`,
    [
      { json: JSON.stringify({ detail: 'late' }) },
      'playbook/acme/alpha/late',
      { at: '2026-10-05T09:00:00.000Z', by: 'tester' },
    ],
  );
  return client;
}

describe.skipIf(skipped)(`A read on PostgreSQL while an append is still open${notice}`, () => {
  it('oldest first, stays behind it, and delivers every message once after it commits', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    await noting(ledger, 'notes', 'noted', 'before');
    const open = await anAppendLeftOpen(database, 'playbook/acme/alpha/late', 'noted');
    await noting(ledger, 'notes', 'noted', 'after');

    const whileOpen = await reading(ledger, everything, 'asc');
    await open.query('COMMIT');
    const rest = await reading(ledger, everything, 'asc', String(whileOpen.records.at(-1)?.cursor));

    expect([details(whileOpen), details(rest)]).toEqual([['before'], ['late', 'after']]);
  });

  it('newest first, reads every message committed, the one committed after it included', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    await noting(ledger, 'notes', 'noted', 'before');
    const open = await anAppendLeftOpen(database, 'playbook/acme/alpha/late', 'noted');
    await noting(ledger, 'notes', 'noted', 'after');

    const whileOpen = await reading(ledger, everything, 'desc');
    await open.query('COMMIT');
    const afterCommit = await reading(ledger, everything, 'desc');

    expect([details(whileOpen), details(afterCommit)]).toEqual([
      ['after', 'before'],
      ['after', 'late', 'before'],
    ]);
  });

  it('by correlation, stays behind it oldest first, and delivers the message committed late once after', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    const correlated: RecordedSelection = { kind: 'correlated', correlation: 'root' };
    await notingOfRoot(ledger, 'run_started', 'before');
    const child = 'playbook/acme/alpha/runs/child';
    const open = await anAppendLeftOpen(database, child, 'run_started', { correlationId: 'root' });
    await notingOfRoot(ledger, 'run_succeeded', 'after');

    const whileOpen = await reading(ledger, correlated, 'asc');
    await open.query('COMMIT');
    const rest = await reading(ledger, correlated, 'asc', String(whileOpen.records.at(-1)?.cursor));

    expect([details(whileOpen), details(rest)]).toEqual([['before'], ['late', 'after']]);
  });
});

describe.skipIf(skipped)(
  `The facts appended to a playbook on PostgreSQL while an append is still open${notice}`,
  () => {
    it('stay behind it, so a cursor of now leaves the message committed late to be read, and a wait ends once it commits', async () => {
      const { database, ledger } = await aLedgerOnItsOwnDatabase();
      await noting(ledger, 'notes', 'noted', 'before');
      const open = await anAppendLeftOpen(database, 'playbook/acme/alpha/late', 'noted');
      await noting(ledger, 'notes', 'noted', 'after');

      const now = await appendedTo(ledger);
      const whileOpen = await appendedTo(ledger, now.cursor);
      const woken = waitedFor(ledger, whileOpen.through);
      await open.query('COMMIT');
      await woken;
      const rest = await appendedTo(ledger, whileOpen.cursor);

      expect(whileOpen.facts).toEqual([]);
      expect(rest.facts.map(({ stream }) => stream)).toEqual(['playbook/acme/alpha/late', 'playbook/acme/alpha/notes']);
    });
  },
);

describe.skipIf(skipped)(`A list of runs on PostgreSQL while an append is still open${notice}`, () => {
  it('lists runs oldest first behind it, and every run once after it commits', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    await noting(ledger, 'runs/r-before', 'run_started', 'before');
    const open = await anAppendLeftOpen(database, 'playbook/acme/alpha/runs/r-late', 'run_started');
    await noting(ledger, 'runs/r-after', 'run_started', 'after');

    const whileOpen = await reading(ledger, runs, 'asc');
    await open.query('COMMIT');
    const rest = await reading(ledger, runs, 'asc', String(whileOpen.records.at(-1)?.cursor));

    expect([details(whileOpen), details(rest)]).toEqual([['before'], ['late', 'after']]);
  });
});

describe.skipIf(skipped)(
  `A read on PostgreSQL oldest first while a write of another database of the server is open${notice}`,
  () => {
    it('lets that write hide nothing while it stays open', async () => {
      const { ledger } = await aLedgerOnItsOwnDatabase();
      await noting(ledger, 'notes', 'noted', 'before');
      const elsewhere = await aWriteLeftOpenElsewhere();
      await noting(ledger, 'notes', 'noted', 'after');

      const whileOpen = await reading(ledger, everything, 'asc');
      await elsewhere.client.query('COMMIT');

      expect(details(whileOpen)).toEqual(['before', 'after']);
    });

    it.each(readsOldestFirst)(
      'lets that write hide nothing of %s when it ends after the read took its snapshot',
      async (_read, selection) => {
        const { database, ledger } = await aLedgerOnItsOwnDatabase();
        await noting(ledger, 'runs/r-before', 'run_started', 'before');
        const elsewhere = await aWriteLeftOpenElsewhere();
        await noting(ledger, 'runs/r-after', 'run_started', 'after');
        const reader = await aReaderEndingTheWriteMidway(database, () => elsewhere.client.query('COMMIT'));
        const store = postgresqlRecordedStore(reader);

        const page = await store.readRecorded('playbook/acme/alpha/', selection, { order: 'asc', limit: 10 });

        expect(page.records.map(({ data }) => data)).toEqual([{ detail: 'before' }, { detail: 'after' }]);
      },
    );
  },
);

describe.skipIf(skipped)(`A fold beside an advance of the same row on PostgreSQL${notice}`, () => {
  it('leaves the columns the advance wrote, the fold waiting for the advance to commit before it reads the row', async () => {
    const gate = aStatementGate();
    const { database, ledger } = await aLedgerOfTopics(gate);
    const advancing = await postgresqlConnected(database);
    await advancing.query('BEGIN');
    await advancing.query("UPDATE topics_2 SET open = false, next_at = NULL, due_at = NULL WHERE row_key = 'spring'");
    const lockAsked = gate.sent('SELECT 1 FROM topics_2');
    const readingTheRow = gate.stopBefore(aRowRead);

    const folding = Effect.runPromise(
      ledger.execute('playbook/acme/alpha/notes/n1', topicFacts, [
        { type: 'topic_noted', data: { topic: 'spring', note: 'during' } },
      ]),
    );
    await lockAsked;
    await advancing.query('COMMIT');
    await readingTheRow.reached;
    const whileReading = await rowLockedNow(database, 'topics_2', 'spring');
    readingTheRow.go();
    await folding;

    expect(whileReading).toContain('could not obtain lock on row in relation "topics_2"');
    expect(
      await postgresqlQueried(database, "SELECT note, open, next_at, due_at FROM topics_2 WHERE row_key = 'spring'"),
    ).toEqual([{ note: 'during', open: false, next_at: null, due_at: null }]);
  });
});

describe.skipIf(skipped)(`Two appends that fold into one row at once on PostgreSQL${notice}`, () => {
  it.each([
    ['the note', 'the opening'],
    ['the opening', 'the note'],
  ] as const)(
    'fold one after the other, each from the row the other left, so neither is lost: %s holds the row while %s asks for it',
    async (first, second) => {
      const gate = aStatementGate();
      const { database, ledger } = await aLedgerOfTopics(gate);
      const appends = {
        'the note': () =>
          Effect.runPromise(
            ledger.execute('playbook/acme/alpha/notes/n1', topicFacts, [
              { type: 'topic_noted', data: { topic: 'spring', note: 'during' } },
            ]),
          ),
        'the opening': () =>
          Effect.runPromise(
            ledger.execute('playbook/acme/alpha/runs/r2', topicFacts, [
              { type: 'topic_opened', data: { topic: 'spring', at: 2000 } },
            ]),
          ),
      };
      const readingTheRow = gate.stopBefore(aRowRead);

      const holding = appends[first]();
      await readingTheRow.reached;
      const asked = gate.sent(aRowLockAsked);
      const asking = appends[second]();
      await asked;
      readingTheRow.go();
      await Promise.all([holding, asking]);

      expect(await postgresqlQueried(database, springOf)).toEqual([{ note: 'during', next_at: '7000' }]);
    },
  );
});

describe.skipIf(skipped)(
  `A scrub beside an append that folds into the row it folds again on PostgreSQL${notice}`,
  () => {
    it.each([
      ['the scrub', 'the opening'],
      ['the opening', 'the scrub'],
    ] as const)(
      'leaves the row folded from the scrubbed fact and the appended one, whichever folds first: %s holds the row while %s asks for it',
      async (first, second) => {
        const gate = aStatementGate();
        const { database, ledger } = await aLedgerOfTopics(gate);
        await Effect.runPromise(
          ledger.execute('playbook/acme/alpha/notes/n1', topicFacts, [
            { type: 'topic_noted', data: { topic: 'spring', note: 'call me on 0123' } },
          ]),
        );
        const writes = {
          'the scrub': () =>
            Effect.runPromise(
              ledger.scrubFact('playbook/acme/alpha/notes/n1', 1, {
                eventSchema: topicFacts.eventSchema,
                data: { topic: 'spring', note: 'a note was erased' },
                erasure: { type: 'topic_noted', data: { topic: 'erased', note: 'a note was erased' } },
                context: { at: '2026-10-06T09:00:00.000Z', by: 'eraser' },
              }),
            ),
          'the opening': () =>
            Effect.runPromise(
              ledger.execute('playbook/acme/alpha/runs/r2', topicFacts, [
                { type: 'topic_opened', data: { topic: 'spring', at: 2000 } },
              ]),
            ),
        };
        const folding = gate.stopBefore('INSERT INTO topics_2');

        const holding = writes[first]();
        await folding.reached;
        const asked = gate.sent(aRowLockAsked);
        const asking = writes[second]();
        await asked;
        folding.go();
        await Promise.all([holding, asking]);

        expect(await postgresqlQueried(database, springOf)).toEqual([{ note: 'a note was erased', next_at: '7000' }]);
      },
    );
  },
);

describe.skipIf(skipped)(`The most values a statement binds on the PostgreSQL host${notice}`, () => {
  it('are 65,535, which PostgreSQL takes in one statement, refusing one more', async () => {
    const database = await aDatabase();
    const { connection, dispose } = await openConnectionWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    onTestFinished(dispose);

    expect(connection.mostBoundValues).toBe(postgresqlMostBoundValues);
    expect(await connection.read(valuesListOf(postgresqlMostBoundValues))).toEqual([
      { counted: String(postgresqlMostBoundValues) },
    ]);
    await expect(connection.read(valuesListOf(postgresqlMostBoundValues + 1))).rejects.toBeInstanceOf(Error);
  });
});

describe.skipIf(skipped)(`The holds on a content beside its removal on PostgreSQL${notice}`, () => {
  it('waits to remove a content while a fold holds the lock of its digest, and answers held once that fold commits its hold', async () => {
    const database = await aDatabase();
    const gate = aStatementGate();
    const { ledger, sha256 } = await aLedgerHolding(database, gate);
    const folding = await theDigestLockedBy(database, sha256);
    await folding.query(
      `INSERT INTO content_references_2 (org_key, playbook_key, stream, sha256, held) VALUES ($1, $2, 'notes/n1', $3, 1)`,
      [orgKey, prefix, sha256],
    );
    const lockAsked = gate.sent(digestLockOf(sha256));
    const checking = gate.stopBefore('SELECT 1 AS held FROM content_references_2');

    const removing = at(pastItsHour, ledger.removeUnheld(alpha, sha256));
    await lockAsked;
    await folding.query('COMMIT');
    await checking.reached;
    const whileChecking = await heldNow(database, digestLockOf(sha256));
    checking.go();

    expect(whileChecking).toBe(true);
    expect(await removing).toBe('held');
  });

  it('waits to fold a hold while a removal holds the lock of its digest, and folds it once the removal ends', async () => {
    const database = await aDatabase();
    const gate = aStatementGate();
    const { ledger, sha256 } = await aLedgerHolding(database, gate);
    const removing = await theDigestLockedBy(database, sha256);
    const lockAsked = gate.sent(digestLockOf(sha256));
    const holding = gate.stopBefore('INSERT INTO content_references_2');

    const folding = Effect.runPromise(
      ledger.execute('playbook/acme/alpha/notes/n1', heldNotes, [{ type: 'note_kept', data: { sha256 } }]),
    );
    await lockAsked;
    await removing.query('COMMIT');
    await holding.reached;
    const whileHolding = await heldNow(database, digestLockOf(sha256));
    holding.go();
    await folding;

    expect(whileHolding).toBe(true);

    expect(
      await postgresqlQueried(database, 'SELECT stream, sha256, held::int AS held FROM content_references_2'),
    ).toEqual([{ stream: 'notes/n1', sha256, held: 1 }]);
    expect(await at(pastItsHour, ledger.removeUnheld(alpha, sha256))).toBe('held');
  });
});

describe.skipIf(skipped)(`The playbook's indexes on PostgreSQL${notice}`, () => {
  it('are created when the ledger opens, once however often it opens', async () => {
    const database = await aDatabase();
    const first = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await first.dispose();
    const second = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await second.dispose();

    expect(
      await postgresqlQueried(
        database,
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('emt_messages', 'emt_streams') AND indexname LIKE 'ledger%' ORDER BY indexname",
      ),
    ).toEqual(thePlaybookIndexes);
  });

  it('are found, not created again, by a start that an append left open does not hold up', async () => {
    const database = await aLedgerOnItsOwnDatabasePlaybookIndexesPostgresql();
    const open = await anAppendLeftOpenPlaybookIndexesPostgresql(database);

    const started = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await started.dispose();
    await open.query('COMMIT');

    expect(
      await postgresqlQueried(
        database,
        "SELECT count(*)::int AS indexes FROM pg_indexes WHERE tablename IN ('emt_messages', 'emt_streams') AND indexname LIKE 'ledger%'",
      ),
    ).toEqual([{ indexes: thePlaybookIndexes.length }]);
  });
});
