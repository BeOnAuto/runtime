import { Effect, type Schema } from 'effect';

import type { DatabaseSettings } from '../database/host-databases.ts';
import { someFolder } from '../projector/folder.ts';
import { definitionStreamOf } from '../projector/playbook-definitions.ts';
import type { Projector } from '../projector/projector.ts';
import { until } from '../testing/until.ts';
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

function contextOf(name: string, version: number) {
  return { by: 'acme-admin', at: savedAt, definitionType: tallyType, definitionName: name, definitionVersion: version };
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
  const tallies = () => Effect.runPromise(talliesOf(views.store.database, alphaKey));
  const named = async (details: TallyDetails) => (await tallies()).find(({ tally }) => tally === tallyOf(details));
  return {
    ...views,
    savedTally: async (name, details) => {
      const version = (versions.get(name) ?? 0) + 1;
      versions.set(name, version);
      const type = version === 1 ? 'definition_created' : 'definition_updated';
      const content = { source: `the ${name} tally, version ${version}`, details };
      await views.append(tallyStream, [{ type, data: { content } }], contextOf(name, version));
    },
    retiredTally: async (name) => {
      await views.append(
        tallyStream,
        [{ type: 'definition_retired', data: {} }],
        contextOf(name, Number(versions.get(name))),
      );
    },
    tallies,
    outputs: () => Effect.runPromise(talliedOutputsOf(views.store.database, alphaKey)),
    untilTally: (details, holds) =>
      until(async () => {
        const row = await named(details);
        if (row === undefined || !holds(row)) {
          throw new Error(`The tally of ${tallyOf(details)} does not hold yet: ${JSON.stringify(row)}`);
        }
        return row;
      }),
    goneTally: (details) =>
      until(async () => {
        if ((await named(details)) !== undefined) {
          throw new Error(`The tally of ${tallyOf(details)} is still kept`);
        }
      }),
    startWithTallies: (more = {}, rebuildsAtOnce = rebuildsByDefault) =>
      views.start({ ...more, besides: [someFolder(tallyFolderOf(rebuildsAtOnce))] }),
    watchingTallies,
  };
}
