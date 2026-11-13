import { HeldContentUnchecked, LedgerChores, type LedgerServices } from '@on.auto/ledger';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Context, Effect, Layer, ManagedRuntime, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { ledgerOfContentNotFound, withItsContentFound } from './ledger-of-content-not-found.ts';
import { ledgerRefusalIn } from './ledger-refusals.ts';

const inTheFile = { store: 'sqlite', file: '/data/ledger.db' } as const;

const inPostgreSQL = {
  store: 'postgresql',
  url: Redacted.make('postgresql://playbooks:a-secret-password@db.example.com/auto_runtime'),
  host: 'db.example.com:5432',
  database: 'auto_runtime',
  credentials: { kind: 'url' },
} as const;

const inTheDatabase = { store: 'ledger' } as const;

const inTheBucket = {
  store: 'object-storage',
  location: { bucket: 'playbook-content', prefix: 'production' },
  endpoint: 'https://access:secret@storage.example.com:9000/base',
  region: 'eu-west-1',
} as const;

const askedAt = 'Need a hand? Ask us on Discord: https://discord.gg/B8BKcKMRm8';

const notMoved = 'Auto Runtime does not move content from one store to another.';

describe('a ledger whose records name content this server finds kept in the other store', () => {
  it('says the content is in a bucket while the server keeps content in the ledger’s database, and to set CONTENT_STORE_URL back', () => {
    const refused = ledgerOfContentNotFound(
      { checked: 16, keptElsewhere: 16, missing: 0 },
      { ledger: inTheFile, content: inTheDatabase },
    );

    expect(refused.message).toBe(
      `The ledger is kept in the file /data/ledger.db, and its records name content this server cannot find. Content is kept in the ledger's database, since CONTENT_STORE_URL is not set, but 16 of the 16 it looked for are kept on object storage. Set CONTENT_STORE_URL, and the endpoint, region and credentials of its bucket, as they were when that content was kept, then start Auto Runtime again. ${notMoved} ${askedAt}`,
    );
    expect(String(refused)).toMatch(/^LedgerOfContentNotFound: The ledger is kept in the file /u);
  });

  it('says the content is in the ledger’s database while the server keeps content in a bucket, and to remove CONTENT_STORE_URL, naming no credential', () => {
    const refused = ledgerOfContentNotFound(
      { checked: 3, keptElsewhere: 3, missing: 0 },
      { ledger: inPostgreSQL, content: inTheBucket },
    );

    expect([refused.happened, refused.remedy.says]).toEqual([
      "The ledger is kept in PostgreSQL, in the database auto_runtime on db.example.com:5432, and its records name content this server cannot find. Content is kept on object storage, in the bucket playbook-content under production/, on storage.example.com:9000, which CONTENT_STORE_URL names, but 3 of the 3 it looked for are kept in the ledger's database.",
      `Remove CONTENT_STORE_URL, as it was when that content was kept in the ledger's database, then start Auto Runtime again. ${notMoved}`,
    ]);
    expect(refused.message).not.toMatch(/secret|access/u);
  });
});

describe('a ledger whose records name content this server finds nowhere', () => {
  it('says the content is not in the bucket the server keeps content in, and to name the bucket that keeps it or restore it beside the ledger', () => {
    const refused = ledgerOfContentNotFound(
      { checked: 16, keptElsewhere: 0, missing: 2 },
      { ledger: inTheFile, content: inTheBucket },
    );

    expect([refused.happened, refused.remedy]).toEqual([
      'The ledger is kept in the file /data/ledger.db, and its records name content this server cannot find. Content is kept on object storage, in the bucket playbook-content under production/, on storage.example.com:9000, which CONTENT_STORE_URL names, but 2 of the 16 it looked for are not there.',
      {
        says: 'Set CONTENT_STORE_URL, and the endpoint, region and credentials of its bucket, to the bucket and prefix that keep that content, or restore the bucket from a backup taken at the same time as the ledger, then start Auto Runtime again.',
        command: undefined,
      },
    ]);
  });

  it('says content kept in the ledger’s database is not there, and to restore the database; and names both where both are found', () => {
    const lost = ledgerOfContentNotFound(
      { checked: 4, keptElsewhere: 0, missing: 1 },
      { ledger: inTheFile, content: inTheDatabase },
    );
    const both = ledgerOfContentNotFound(
      { checked: 4, keptElsewhere: 2, missing: 1 },
      { ledger: inTheFile, content: inTheDatabase },
    );

    expect([lost.remedy.says, both.happened]).toEqual([
      "Restore the ledger's database from a backup that holds its records and their content together, then start Auto Runtime again.",
      "The ledger is kept in the file /data/ledger.db, and its records name content this server cannot find. Content is kept in the ledger's database, since CONTENT_STORE_URL is not set, but 2 of the 4 it looked for are kept on object storage, and 1 of the 4 it looked for is not there.",
    ]);
    expect(both.remedy.says).toMatch(/^Set CONTENT_STORE_URL, and the endpoint, region and credentials of its bucket/u);
  });

  it('is found inside the failure it causes, as a ledger of another version is', () => {
    const refused = ledgerOfContentNotFound(
      { checked: 1, keptElsewhere: 1, missing: 0 },
      { ledger: inTheFile, content: inTheDatabase },
    );

    expect(ledgerRefusalIn(new Error('The services could not start', { cause: refused }))).toBe(refused);
  });
});

const lookFailed = new Error('disk I/O error');

function withALookThatFails(): Layer.Layer<LedgerServices> {
  return Layer.flatMap(ledgerLayer({ fileName: ':memory:' }), (context) =>
    Layer.succeedContext(
      Context.add(context, LedgerChores, {
        ...Context.get(context, LedgerChores),
        heldContentFound: () => Effect.fail(new HeldContentUnchecked({ failure: lookFailed })),
      }),
    ),
  );
}

async function startedWith(layer: Layer.Layer<LedgerServices>): Promise<unknown> {
  const runtime = ManagedRuntime.make(layer);
  try {
    await runtime.runPromise(Effect.void);
    return 'started';
  } catch (failure) {
    return failure;
  } finally {
    await runtime.dispose();
  }
}

describe('a look at the content the records name that cannot be made as the ledger opens', () => {
  it('stops the start with the failure itself where content is kept in the ledger’s database, and never counts the content missing', async () => {
    const failure = await startedWith(
      withItsContentFound(withALookThatFails(), { ledger: inTheFile, content: inTheDatabase }),
    );

    expect([String(failure).includes('disk I/O error'), ledgerRefusalIn(failure)]).toEqual([true, undefined]);
  });

  it('stops the start in the words the shell gives for a store it could not reach, where content is kept in a bucket', async () => {
    const failure = await startedWith(
      withItsContentFound(
        withALookThatFails(),
        { ledger: inTheFile, content: inTheBucket },
        (cause) =>
          new Error(
            `CONTENT_STORE_URL names the bucket playbook-content, which could not be reached: ${String(cause)}`,
          ),
      ),
    );

    expect(String(failure)).toContain(
      'CONTENT_STORE_URL names the bucket playbook-content, which could not be reached: Error: disk I/O error',
    );
  });
});
