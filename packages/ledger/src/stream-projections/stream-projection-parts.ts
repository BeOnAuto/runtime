import type { SQL } from '@event-driven-io/dumbo';
import {
  checkedStreamProjection,
  streamPrefixOfAddress,
  type KeptProjection,
  type ProjectedAddress,
  type StreamProjection,
} from '@on.auto/operations';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import { inTurn, type InlineRegistration } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { failedCheckOf, type FailedCheck } from './build-checks.ts';
import { caughtUp, type Built } from './catch-up.ts';
import { contiguousFoldOf, placeOfItsStream } from './stream-folds.ts';
import { emptied, freshnessOf, type StreamFreshness } from './stream-statements.ts';
import { prepared, tablesOf } from './stream-tables.ts';

export type Kept =
  | ({ readonly kept: 'built'; readonly projection: string } & Built)
  | { readonly kept: 'reset'; readonly projection: string; readonly playbook: string; readonly because: ResetBecause }
  | { readonly kept: 'disagreed'; readonly projection: string; readonly playbook: string };

type ResetBecause = 'checkpoint_ahead' | FailedCheck | 'asked';

interface StreamStatements {
  readonly query: (sql: SQL) => Promise<readonly unknown[]>;
  readonly inTransaction: InTransaction;
}

export interface StreamProjectionParts {
  readonly named: ReturnType<typeof tablesOf>;
  readonly tables: readonly KeptProjection[];
  readonly registrations: readonly InlineRegistration[];
  readonly prepare: (execute: StatementExecutor, inTransaction: InTransaction) => Promise<void>;
  readonly freshOn: (
    statements: StreamStatements,
  ) => (table: string, address: ProjectedAddress) => Promise<readonly Kept[]>;
  readonly resetOn: (
    inTransaction: InTransaction,
  ) => (name: string, address: ProjectedAddress) => Promise<readonly Kept[]>;
  readonly scrubbed: (execute: StatementExecutor, stream: string) => Promise<void>;
}

interface Parts {
  readonly dialect: ProjectionDialect;
  readonly mostBytes: number;
}

function resetIn(projection: StreamProjection, prefix: string, inTransaction: InTransaction): Promise<void> {
  return inTransaction((execute) => inTurn(emptied(projection, prefix), (statement) => execute.command(statement)));
}

interface Freshening {
  readonly parts: Parts;
  readonly projection: StreamProjection;
  readonly statements: StreamStatements;
  readonly prefix: string;
}

async function behindCaughtUp(
  { parts, projection, statements, prefix }: Freshening,
  freshness: readonly StreamFreshness[],
): Promise<readonly Kept[]> {
  const built: Kept[] = [];
  await inTurn(
    freshness.filter(({ head, folded }) => folded < head),
    async ({ stream, folded }) => {
      const place = { prefix, stream };
      const caught = await caughtUp({ ...parts, projection }, statements.inTransaction, { place, from: folded });
      built.push({ kept: 'built', projection: projection.name, ...caught });
    },
  );
  return built;
}

function playbookOf(prefix: string): string {
  return prefix.slice(0, -1);
}

function resetOf(projection: StreamProjection, prefix: string, because: ResetBecause): Kept {
  return { kept: 'reset', projection: projection.name, playbook: playbookOf(prefix), because };
}

async function brought(freshening: Freshening, again: boolean): Promise<readonly Kept[]> {
  const { parts, projection, statements, prefix } = freshening;
  const found = await freshnessOf(statements.query, parts.dialect, projection, prefix);
  const ahead = found.some(({ head, folded }) => folded > head);
  if (ahead) {
    await resetIn(projection, prefix, statements.inTransaction);
  }
  const freshness = ahead ? found.map((stream) => ({ ...stream, folded: 0 })) : found;
  const reset: readonly Kept[] = ahead ? [resetOf(projection, prefix, 'checkpoint_ahead')] : [];
  const built = await behindCaughtUp(freshening, freshness);
  const failed =
    built.length === 0
      ? undefined
      : await failedCheckOf({ query: statements.query, dialect: parts.dialect, projection, prefix });
  return failed === undefined
    ? [...reset, ...built]
    : [...reset, ...built, ...(await afterAFailedCheck(freshening, { failed, again }))];
}

async function afterAFailedCheck(
  freshening: Freshening,
  { failed, again }: { readonly failed: FailedCheck; readonly again: boolean },
): Promise<readonly Kept[]> {
  const { projection, statements, prefix } = freshening;
  if (again) {
    return [{ kept: 'disagreed', projection: projection.name, playbook: playbookOf(prefix) }];
  }
  await resetIn(projection, prefix, statements.inTransaction);
  return [resetOf(projection, prefix, failed), ...(await brought(freshening, true))];
}

function projectionOfTable(projections: readonly StreamProjection[], table: string): StreamProjection | undefined {
  return projections.find((projection) => projection.tables.some(({ name }) => name === table));
}

export function streamProjectionPartsOf(
  dialect: ProjectionDialect,
  given: readonly StreamProjection[],
  mostBytes: number,
): StreamProjectionParts {
  const projections = given.map((projection) => checkedStreamProjection(projection));
  const parts = { dialect, mostBytes };
  return {
    named: projections.flatMap((projection) => tablesOf(projection)),
    tables: projections.flatMap(({ tables }) => tables),
    registrations: projections.map((projection) => contiguousFoldOf({ dialect, projection })),
    prepare: (execute, inTransaction) =>
      inTurn(projections, (projection) => prepared(parts, projection, { execute, inTransaction })),
    freshOn: (statements) => (table, address) => {
      const projection = projectionOfTable(projections, table);
      return projection === undefined || address.playbook === undefined
        ? Promise.resolve([])
        : brought({ parts, projection, statements, prefix: streamPrefixOfAddress(address) }, false);
    },
    resetOn: (inTransaction) => async (name, address) => {
      const projection = projections.find((each) => each.name === name);
      if (projection === undefined || address.playbook === undefined) {
        return [];
      }
      const prefix = streamPrefixOfAddress(address);
      await resetIn(projection, prefix, inTransaction);
      return [resetOf(projection, prefix, 'asked')];
    },
    scrubbed: (execute, stream) =>
      inTurn(projections, async (projection) => {
        const place = placeOfItsStream(projection, stream);
        if (place !== undefined) {
          await inTurn(emptied(projection, place.prefix), (statement) => execute.command(statement));
        }
      }),
  };
}
