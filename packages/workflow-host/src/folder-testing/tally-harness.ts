import { Effect, type Schema } from 'effect';

import type { DatabaseSettings } from '../ledger-testing/ledger-connections.ts';
import { someFolder } from '../projector/folder.ts';
import { definitionStreamOf } from '../projector/playbook-definitions.ts';
import type { Projector } from '../projector/projector.ts';
import { alphaKey } from '../views-testing/view-documents.ts';
import { viewHarness, type ViewHarness } from '../views-testing/view-harness.ts';
import {
  talliedOutputsOf,
  talliesOf,
  tallyFolderOf,
  tallyOf,
  tallyType,
  type TalliedOutput,
  type TallyDetails,
  type TallyRow,
} from './tally-folder.ts';

type StartOf = NonNullable<Parameters<ViewHarness['start']>[0]>;

type Through = NonNullable<StartOf['through']>;

interface TallyWatch {
  readonly through: Through;
  readonly phasesOf: (details: TallyDetails) => readonly string[];
}

export interface TallyHarness extends ViewHarness {
  readonly savedTally: (name: string, details: Schema.Json) => Promise<void>;
  readonly retiredTally: (name: string) => Promise<void>;
  readonly tallies: () => Promise<readonly TallyRow[]>;
  readonly outputs: () => Promise<readonly TalliedOutput[]>;
  readonly untilTally: (details: TallyDetails, holds: (row: TallyRow) => boolean) => Promise<TallyRow>;
  readonly goneTally: (details: TallyDetails) => Promise<void>;
  readonly startWithTallies: (more?: StartOf, rebuildsAtOnce?: number) => Projector;
  readonly watchingTallies: () => TallyWatch;
}

const savedAt = '2026-10-06T09:00:00.000Z';

const tallyStream = definitionStreamOf(alphaKey, tallyType);

const rebuildsByDefault = 4;

function contextOf(name: string, version: number, at: string) {
  return { by: 'acme-admin', at, definitionType: tallyType, definitionName: name, definitionVersion: version };
}

function savesInTurn(): () => string {
  const made = { saves: 0 };
  return () => {
    made.saves += 1;
    return new Date(Date.parse(savedAt) + made.saves * 1000).toISOString();
  };
}

function watchingTallies(): TallyWatch {
  const seen: (readonly TallyRow[])[] = [];
  return {
    through: (database) => {
      const rowsRead = Effect.map(talliesOf(database, alphaKey), (rows) => {
        seen.push(rows);
      });
      return {
        ...database,
        write: (statement) => Effect.tap(database.write(statement), () => rowsRead),
        transaction: (statements) => Effect.tap(database.transaction(statements), () => rowsRead),
      };
    },
    phasesOf: (details) =>
      seen.flatMap((rows) => rows.filter(({ tally }) => tally === tallyOf(details)).map(({ phase }) => phase)),
  };
}

export async function tallyHarness(settings: DatabaseSettings): Promise<TallyHarness> {
  const views = await viewHarness(settings, {}, [someFolder(tallyFolderOf(rebuildsByDefault))]);
  const versions = new Map<string, number>();
  const next = savesInTurn();
  const tallies = () => Effect.runPromise(talliesOf(views.store.database, alphaKey));
  const named = async (details: TallyDetails) => (await tallies()).find(({ tally }) => tally === tallyOf(details));
  return {
    ...views,
    savedTally: async (name, details) => {
      const version = (versions.get(name) ?? 0) + 1;
      versions.set(name, version);
      const content = { source: `the ${name} tally, version ${version}`, details };
      const saving =
        version === 1
          ? { type: 'definition_created', data: { content, created_by: { id: 'acme-admin', name: 'acme-admin' } } }
          : { type: 'definition_updated', data: { content } };
      await views.append(tallyStream, [saving], contextOf(name, version, next()));
    },
    retiredTally: async (name) => {
      await views.append(
        tallyStream,
        [{ type: 'definition_retired', data: {} }],
        contextOf(name, Number(versions.get(name)), next()),
      );
    },
    tallies,
    outputs: () => Effect.runPromise(talliedOutputsOf(views.store.database, alphaKey)),
    untilTally: (details, holds) =>
      views.whenFolded(
        () => named(details),
        (row): row is TallyRow => row !== undefined && holds(row),
      ),
    goneTally: async (details) => {
      await views.whenFolded(
        () => named(details),
        (row) => row === undefined,
      );
    },
    startWithTallies: (more = {}, rebuildsAtOnce = rebuildsByDefault) =>
      views.start({ ...more, besides: [someFolder(tallyFolderOf(rebuildsAtOnce))] }),
    watchingTallies,
  };
}
