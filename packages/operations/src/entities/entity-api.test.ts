import { Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { Caller } from '../caller/caller.ts';
import { OrgReader, orgReaderOver } from '../ledger/org-reader.ts';
import { playbookReaderOf } from '../ledger/playbook-ledger.ts';
import { PlaybookReader } from '../ledger/playbook-reader.ts';
import { labelRows, memoryLedger, remarkFacts, remarkRows } from '../testing/index.ts';
import {
  entitiesOf,
  entitiesSentOf,
  valuesAnswered,
  wiredKindNamed,
  wiredKindOf,
  type EntityKind,
} from './entity-kind.ts';
import { readablePlaybooks } from './playbook-access.ts';
import { orgReadsTogether, playbookReadsTogether } from './reads-together.ts';

const acme = { org: 'acme' };

const textsOf: EntityKind<string, readonly string[], { readonly most: number }> = {
  name: 'remark_texts',
  parentOf: (playbook) => playbook,
  key: Schema.String,
  asked: Schema.Struct({ most: Schema.Number }),
  value: Schema.Array(Schema.String),
  read: (playbooks, { most }) =>
    Effect.forEach(playbooks, (playbook) =>
      Effect.map(
        OrgReader.use((reader) =>
          reader.readPlaybookRows(playbook, 'remarks', { where: [], orderBy: [], order: 'asc', limit: most }),
        ),
        (rows) => rows.map(({ row }) => String(row['text'])),
      ),
    ),
};

async function remarked() {
  const ledger = memoryLedger(undefined, [remarkRows, labelRows]);
  const made = (stream: string, text: string) =>
    Effect.runPromise(ledger.service.execute(stream, remarkFacts, [{ type: 'remark_made', data: { text } }]));
  await made('playbook/acme/alpha/remarks/r1', 'of alpha');
  await made('playbook/acme/beta/remarks/r1', 'of beta');
  await made('org/acme/remarks/r1', 'of acme');
  return ledger.service;
}

describe('the entities an org reads by a list of keys', () => {
  it('are read in process, one value a key in the order asked, and nothing read for no key', async () => {
    const reader = orgReaderOver(await remarked(), acme);

    const read = await Effect.runPromise(
      Effect.all([
        entitiesOf(textsOf, ['beta', 'gamma', 'alpha'], { most: 5 }),
        entitiesOf(textsOf, [], { most: 5 }),
      ]).pipe(Effect.provideService(OrgReader, reader)),
    );

    expect(read).toEqual([[['of beta'], [], ['of alpha']], []]);
  });

  it('are read across a boundary where the ledger reads them so', async () => {
    const ledger = await remarked();
    const asked: unknown[] = [];
    const reader = orgReaderOver(
      {
        ...ledger,
        readEntitiesAcross: (kind, org, keys, value) => {
          asked.push(entitiesSentOf(kind, keys, value), org);
          return orgReaderOver(ledger, org).readEntities(kind, keys, value);
        },
      },
      acme,
    );

    const read = await Effect.runPromise(
      entitiesOf(textsOf, ['alpha'], { most: 1 }).pipe(Effect.provideService(OrgReader, reader)),
    );

    expect(read).toEqual([['of alpha']]);
    expect(asked).toEqual([{ kind: 'remark_texts', keys: ['alpha'], parents: ['alpha'], asked: { most: 1 } }, acme]);
  });
});

describe('the entities an org reads by a list of keys, sent as data', () => {
  it('are read as sent, decoding the keys and what was asked, and answered as values the kind decodes', async () => {
    const reader = orgReaderOver(await remarked(), acme);
    const wired = await Effect.runPromise(wiredKindNamed([wiredKindOf(textsOf)], 'remark_texts'));
    const read = (keys: readonly unknown[], asked: unknown) =>
      Effect.runPromiseExit(wired.readSent(keys, asked).pipe(Effect.provideService(OrgReader, reader)));

    const sent = await read(['beta'], { most: 1 });
    const malformed = await read([7], { most: 1 });
    const unknown = await Effect.runPromiseExit(wiredKindNamed([], 'remark_texts'));

    expect(sent).toEqual(Exit.succeed([['of beta']]));
    expect([Exit.hasDies(malformed), Exit.hasDies(unknown)]).toEqual([true, true]);
    expect(await Effect.runPromise(valuesAnswered(textsOf, [['a']]))).toEqual([['a']]);
    expect(Exit.hasDies(await Effect.runPromiseExit(valuesAnswered(textsOf, [7])))).toBe(true);
  });
});

function counted(reader: OrgReader['Service'] | PlaybookReader['Service']) {
  return reader.countProjectedRows('remarks', []);
}

describe('the rows of a projection read by keys and together through the bound readers', () => {
  it('answer each key in its order under the reader’s address, nothing for a projection not kept, and refuse one of child rows', async () => {
    const ledger = await remarked();
    const org = orgReaderOver(ledger, acme);
    const alpha = playbookReaderOf(ledger, { org: 'acme', playbook: 'alpha' });

    const ofTheOrg = await Effect.runPromise(org.readProjectedRowsOfKeys('remarks', ['r2', 'r1']));
    const ofAlpha = await Effect.runPromise(alpha.readProjectedRowsOfKeys('remarks', ['r1']));
    const unkept = await Effect.runPromise(alpha.readProjectedRowsOfKeys('elsewhere', ['r1']));
    const children = await Effect.runPromiseExit(alpha.readProjectedRowsOfKeys('labels', ['r1']));

    expect([ofTheOrg.map((row) => row?.row['text']), ofAlpha.map((row) => row?.playbook), unkept]).toEqual([
      [undefined, 'of acme'],
      ['alpha'],
      [undefined],
    ]);
    expect(Exit.hasDies(children)).toBe(true);
  });

  it('are read together in the org and in a playbook, as the reads answer', async () => {
    const ledger = await remarked();

    const read = await Effect.runPromise(
      Effect.all([orgReadsTogether(OrgReader.use(counted)), playbookReadsTogether(PlaybookReader.use(counted))]).pipe(
        Effect.provideService(OrgReader, orgReaderOver(ledger, acme)),
        Effect.provideService(PlaybookReader, playbookReaderOf(ledger, { org: 'acme', playbook: 'alpha' })),
      ),
    );

    expect(read).toEqual([1, 1]);
  });
});

describe('the playbooks a caller may read', () => {
  it.each([
    ['*', ['beta', 'alpha', 'gamma'], ['alpha', 'beta', 'gamma']],
    [
      ['gamma', 'alpha'],
      ['beta', 'alpha', 'gamma'],
      ['alpha', 'gamma'],
    ],
  ] as const)('are those its access names, sorted: %j of %j', async (playbooks, all, readable) => {
    const caller = { id: 'key_1', name: 'key_1', org: 'acme', permissions: [], playbooks };

    expect(await Effect.runPromise(readablePlaybooks(all).pipe(Effect.provideService(Caller, caller)))).toEqual(
      readable,
    );
  });
});
