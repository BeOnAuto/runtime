import { statement, type Dialect, type Statement } from '@on.auto/ledger';
import { Data, Schema } from 'effect';

import { addressesVerified } from '../people/stored-people-rows.ts';
import type { AuthDatabase } from './auth-database.ts';

export const authLayout = 5;

export const authTablePrefix = 'auth_';

const firstLayout = 1;

const layoutTable = 'auth_layout';

export interface AuthLayoutStep {
  readonly layout: number;
  readonly statements: readonly Statement[];
}

export const sessionsOfAnEarlierLayout = 'auth_sessions';

export const authLayoutSteps: readonly AuthLayoutStep[] = [
  { layout: 2, statements: [] },
  {
    layout: 3,
    statements: [
      statement`DROP INDEX IF EXISTS auth_sessions_expires_at`,
      statement`DROP TABLE IF EXISTS auth_sessions`,
    ],
  },
  { layout: 4, statements: [] },
  { layout: 5, statements: addressesVerified },
];

export interface AuthLayoutCarrying {
  readonly kept: number;
  readonly steps: readonly AuthLayoutStep[];
  readonly tables: readonly string[];
}

interface RefusedLayout {
  readonly found: number | undefined;
  readonly kept: number;
}

export class AuthLayoutRefused extends Data.TaggedError('auth_layout_refused')<
  RefusedLayout & { readonly message: string }
> {}

function withNoLayoutNumber(kept: number): string {
  return `The database holds tables of the sign-in but no layout number, where this server keeps layout ${kept}. No release of Auto Runtime leaves its sign-in tables this way, so they were changed outside it: restore the database from a backup taken before that change`;
}

function whatWasFound(found: number): string {
  return `The tables of the sign-in in the database are in layout ${found}`;
}

function whatToDo(found: number, kept: number): readonly string[] {
  return found > kept
    ? [
        'Upgrades go forward only',
        'Open this database with the release that upgraded it, or a compatible later release',
      ]
    : [];
}

function withALayoutNumber(found: number, kept: number): string {
  const wasFound = `${whatWasFound(found)}, where this server keeps layout ${kept} of them`;
  return [wasFound, ...whatToDo(found, kept)].join('. ');
}

function authLayoutRefused(refused: RefusedLayout): AuthLayoutRefused {
  const message =
    refused.found === undefined ? withNoLayoutNumber(refused.kept) : withALayoutNumber(refused.found, refused.kept);
  return new AuthLayoutRefused({ ...refused, message });
}

const tablesOfTheSchema: Readonly<Record<Dialect, Statement>> = {
  sqlite: statement`SELECT name FROM sqlite_master WHERE type = 'table'`,
  postgresql: statement`SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()`,
};

const takenOneAtATime: Readonly<Record<Dialect, readonly Statement[]>> = {
  sqlite: [],
  postgresql: [statement`SELECT pg_advisory_xact_lock(hashtextextended('auth_layout', 0))`],
};

const layoutRead = statement`SELECT layout FROM auth_layout`;

const layoutTableMade = statement`CREATE TABLE IF NOT EXISTS auth_layout (
    one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row),
    layout INTEGER NOT NULL
  )`;

function layoutWritten(layout: number): Statement {
  return statement`INSERT INTO auth_layout (layout) VALUES (${layout}) ON CONFLICT (one_row) DO NOTHING`;
}

function layoutReached(layout: number): Statement {
  return statement`UPDATE auth_layout SET layout = ${layout} WHERE layout = ${layout - 1}`;
}

const decodeNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

const decodeLayouts = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ layout: Schema.Number })));

interface FoundLayout {
  readonly layout: number | undefined;
  readonly holdsTables: boolean;
}

async function layoutIn(database: AuthDatabase): Promise<number | undefined> {
  const [kept] = decodeLayouts(await database.read(layoutRead));
  return kept?.layout;
}

async function layoutFound(database: AuthDatabase, tables: readonly string[]): Promise<FoundLayout> {
  const names = new Set(decodeNames(await database.read(tablesOfTheSchema[database.dialect])).map(({ name }) => name));
  return {
    layout: names.has(layoutTable) ? await layoutIn(database) : undefined,
    holdsTables: tables.some((table) => names.has(table)),
  };
}

async function foundOnceLaid(database: AuthDatabase, { kept, tables }: AuthLayoutCarrying): Promise<FoundLayout> {
  const found = await layoutFound(database, tables);
  if (found.layout !== undefined || found.holdsTables) {
    return found;
  }
  await database.transaction([...takenOneAtATime[database.dialect], layoutTableMade, layoutWritten(kept)]);
  return layoutFound(database, tables);
}

function isCarriedForward(layout: number | undefined, kept: number): layout is number {
  return layout !== undefined && layout >= firstLayout && layout < kept;
}

function stepTo(layout: number, steps: readonly AuthLayoutStep[]): AuthLayoutStep {
  const step = steps.find((each) => each.layout === layout);
  if (step === undefined) {
    throw new Error(`The sign-in's store was given no step to layout ${layout} of its tables, where it takes one`);
  }
  return step;
}

function stepsFrom(layout: number, { kept, steps }: AuthLayoutCarrying): readonly AuthLayoutStep[] {
  return Array.from({ length: kept - layout }, (_, index) => stepTo(layout + index + 1, steps));
}

function stepTaken(database: AuthDatabase, { layout, statements }: AuthLayoutStep): Promise<unknown> {
  return database.transaction([...takenOneAtATime[database.dialect], ...statements, layoutReached(layout)]);
}

export async function authLayoutKept(database: AuthDatabase, carrying: AuthLayoutCarrying): Promise<void> {
  const { layout } = await foundOnceLaid(database, carrying);
  if (layout === carrying.kept) {
    return;
  }
  if (!isCarriedForward(layout, carrying.kept)) {
    throw authLayoutRefused({ found: layout, kept: carrying.kept });
  }
  await stepsFrom(layout, carrying).reduce(async (before: Promise<unknown>, step) => {
    await before;
    return stepTaken(database, step);
  }, Promise.resolve());
}
